// Wrapper mínimo sobre IndexedDB.
//
// Almacenes:
//  - chunks:     trozos de la grabación en orden { id(auto), recordingId, index, blob }
//  - recordings: metadatos { id, createdAt, mode, mime, name, status, durationMs, bytes }
//  - settings:   pares clave/valor { key, value }  (ajustes + handle de carpeta)
//
// IndexedDB es la red de seguridad: aunque Chrome se cierre a mitad de grabación,
// los chunks ya escritos quedan acá y se pueden recuperar (ver manager).

import {
  DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_RECORDINGS, STORE_SETTINGS,
} from './constants.js';

let _dbPromise = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const s = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('recordingId', 'recordingId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
        db.createObjectStore(STORE_RECORDINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function store(name, mode) {
  return open().then((db) => db.transaction(name, mode).objectStore(name));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  // --- settings ---
  async getSetting(key) {
    const s = await store(STORE_SETTINGS, 'readonly');
    const r = await reqToPromise(s.get(key));
    return r ? r.value : undefined;
  },
  async setSetting(key, value) {
    const s = await store(STORE_SETTINGS, 'readwrite');
    await reqToPromise(s.put({ key, value }));
  },
  async deleteSetting(key) {
    const s = await store(STORE_SETTINGS, 'readwrite');
    await reqToPromise(s.delete(key));
  },

  // --- recordings ---
  async createRecording(rec) {
    const s = await store(STORE_RECORDINGS, 'readwrite');
    await reqToPromise(s.put(rec));
    return rec;
  },
  async updateRecording(id, patch) {
    const s = await store(STORE_RECORDINGS, 'readwrite');
    const cur = await reqToPromise(s.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await reqToPromise(s.put(next));
    return next;
  },
  async getRecording(id) {
    const s = await store(STORE_RECORDINGS, 'readonly');
    return reqToPromise(s.get(id));
  },
  async listRecordings() {
    const s = await store(STORE_RECORDINGS, 'readonly');
    const all = await reqToPromise(s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  // --- chunks ---
  async appendChunk(recordingId, index, blob) {
    const s = await store(STORE_CHUNKS, 'readwrite');
    await reqToPromise(s.add({ recordingId, index, blob }));
  },
  async getChunks(recordingId) {
    const s = await store(STORE_CHUNKS, 'readonly');
    const idx = s.index('recordingId');
    const rows = await reqToPromise(idx.getAll(IDBKeyRange.only(recordingId)));
    return rows.sort((a, b) => a.index - b.index).map((c) => c.blob);
  },
  async countChunks(recordingId) {
    const s = await store(STORE_CHUNKS, 'readonly');
    const idx = s.index('recordingId');
    return reqToPromise(idx.count(IDBKeyRange.only(recordingId)));
  },
  async assembleBlob(recordingId, mime) {
    const chunks = await this.getChunks(recordingId);
    return new Blob(chunks, { type: mime });
  },

  // --- borrado en cascada ---
  async deleteRecording(id) {
    const database = await open();
    await new Promise((resolve, reject) => {
      const t = database.transaction([STORE_CHUNKS, STORE_RECORDINGS], 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.objectStore(STORE_RECORDINGS).delete(id);
      const cursor = t.objectStore(STORE_CHUNKS).index('recordingId').openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) { c.delete(); c.continue(); }
      };
    });
  },
};
