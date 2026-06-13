// ─────────────────────────────────────────────────────────────────────────
//  CAPA DE SINKS  — el punto de extensión clave del proyecto.
//
//  Un "sink" es un destino para los chunks de la grabación. El motor de
//  grabación (offscreen.js) no sabe NI le importa a dónde van los datos:
//  solo llama sink.writeChunk(blob) por cada trozo. Esto desacopla
//  "grabar" de "guardar".
//
//  Sinks implementados (v1, 100% local):
//    • IndexedDBSink  — siempre activo: buffer + recuperación ante crash.
//    • FileSystemSink — escritura incremental a una carpeta del SO (opcional).
//
//  Sink planeado (v2, NO implementado):
//    • RemoteSink     — sube cada chunk a un servidor.
//
//  → Para habilitar el envío al servidor en v2, NO hay que tocar el motor:
//    basta con  sinks.push(new RemoteSink({...}))  en offscreen.js.
//
//  Interfaz de un sink (todos los métodos opcionales salvo writeChunk):
//    init(meta)        antes de empezar a grabar
//    writeChunk(blob)  por cada chunk (puede ser async)
//    finalize(meta)    al detener correctamente
//    abort()           ante error/cancelación
//    name              etiqueta para logs
// ─────────────────────────────────────────────────────────────────────────

import { db } from './db.js';

/** Buffer canónico en IndexedDB. Siempre presente: permite recuperación. */
export class IndexedDBSink {
  constructor(recordingId) {
    this.recordingId = recordingId;
    this.index = 0;
    this.name = 'IndexedDBSink';
  }
  async init() { this.index = 0; }
  async writeChunk(blob) {
    await db.appendChunk(this.recordingId, this.index++, blob);
  }
  async finalize() {}
  async abort() {}
}

/**
 * Escritura incremental a una carpeta del SO vía File System Access API.
 * Escribe cada chunk directo al archivo a medida que llega (no acumula en RAM).
 * Requiere un handle de carpeta con permiso readwrite ya concedido.
 */
export class FileSystemSink {
  constructor(dirHandle, filename, mime) {
    this.dirHandle = dirHandle;
    this.filename = filename;
    this.mime = mime;
    this.name = 'FileSystemSink';
    this._queue = Promise.resolve(); // serializa las escrituras (orden garantizado)
  }
  async init() {
    this.fileHandle = await this.dirHandle.getFileHandle(this.filename, { create: true });
    this.writable = await this.fileHandle.createWritable();
  }
  writeChunk(blob) {
    // Encadenamos para que los chunks se escriban estrictamente en orden.
    this._queue = this._queue.then(() => this.writable.write(blob));
    return this._queue;
  }
  async finalize() {
    await this._queue;
    await this.writable.close();
  }
  async abort() {
    try { await this._queue; } catch {}
    try { await this.writable?.close(); } catch {}
  }
}

/**
 * v2 — NO IMPLEMENTADO. Envía cada chunk a un servidor.
 * Dejado como plantilla para mostrar exactamente dónde engancha el envío remoto.
 * Activarlo en v2 es solo registrar una instancia en el SinkManager.
 */
export class RemoteSink {
  constructor({ endpoint, recordingId, headers = {} } = {}) {
    this.endpoint = endpoint;
    this.recordingId = recordingId;
    this.headers = headers;
    this.index = 0;
    this.name = 'RemoteSink';
  }
  async init(/* meta */) {
    // TODO v2: abrir sesión de subida.
    //   await fetch(`${this.endpoint}/recordings`, {
    //     method: 'POST', headers: this.headers,
    //     body: JSON.stringify({ id: this.recordingId, ...meta }),
    //   });
    throw new Error('RemoteSink no implementado todavía (planeado para v2).');
  }
  async writeChunk(/* blob */) {
    // TODO v2: subir el chunk EN ORDEN, con reintentos/backoff:
    //   await fetchWithRetry(
    //     `${this.endpoint}/recordings/${this.recordingId}/chunks/${this.index}`,
    //     { method: 'PUT', headers: this.headers, body: blob });
    //   this.index++;
  }
  async finalize(/* meta */) {
    // TODO v2: cerrar la subida.
    //   await fetch(`${this.endpoint}/recordings/${this.recordingId}/complete`, {
    //     method: 'POST', headers: this.headers });
  }
  async abort() {
    // TODO v2: marcar como abortada / limpiar parcial en el servidor.
  }
}

/**
 * Orquesta varios sinks a la vez. Si uno falla, lo desactiva y sigue con los
 * demás (la grabación nunca se cae porque, p.ej., se perdió el permiso de la
 * carpeta: IndexedDBSink sigue garantizando que no se pierde nada).
 */
export class SinkManager {
  constructor(sinks) {
    this.entries = sinks.map((sink) => ({ sink, failed: false }));
    this.bytes = 0;
  }
  async init(meta) {
    for (const e of this.entries) {
      try { await e.sink.init?.(meta); }
      catch (err) { console.warn(`[sink ${e.sink.name}] init falló`, err); e.failed = true; }
    }
  }
  async writeChunk(blob) {
    this.bytes += blob.size;
    await Promise.all(this.entries.filter((e) => !e.failed).map(async (e) => {
      try { await e.sink.writeChunk(blob); }
      catch (err) {
        console.warn(`[sink ${e.sink.name}] writeChunk falló; se desactiva`, err);
        e.failed = true;
      }
    }));
  }
  async finalize(meta) {
    await Promise.allSettled(
      this.entries.filter((e) => !e.failed).map((e) => e.sink.finalize?.(meta)),
    );
  }
  async abort() {
    await Promise.allSettled(this.entries.map((e) => e.sink.abort?.()));
  }
  activeNames() {
    return this.entries.filter((e) => !e.failed).map((e) => e.sink.name);
  }
}
