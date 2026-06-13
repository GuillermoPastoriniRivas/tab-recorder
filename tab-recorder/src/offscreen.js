// ─────────────────────────────────────────────────────────────────────────
//  MOTOR DE GRABACIÓN (documento offscreen)
//
//  Entrada:  audio + video de la pestaña  +  audio del micrófono
//  Salida:   1 o 2 archivos:
//              • principal (video+audio, o solo audio)
//              • opcional: copia de SOLO AUDIO (cuando se graba video)
//            En el contenedor elegido (MP4 H.264/AAC o WebM VP9/Opus) y al
//            bitrate del preset de calidad.
//
//  Gotchas mitigados:
//   #1  Capturar la pestaña la silencia → reconectamos su audio a los parlantes.
//   #2  El popup muere → la grabación vive ACÁ.
//   #3  Eco con parlantes → echoCancellation/noiseSuppression en el micrófono.
//   RAM → chunks por timeslice a IndexedDB/disco; nunca todo en memoria.
// ─────────────────────────────────────────────────────────────────────────

import { MSG, TARGET } from './lib/messages.js';
import { TIMESLICE_MS, RECORDING_STATUS, QUALITY, AUDIO_BPS } from './lib/constants.js';
import { db } from './lib/db.js';
import { SinkManager, IndexedDBSink, FileSystemSink /*, RemoteSink */ } from './lib/sinks.js';
import { pickMime, timestampBase } from './lib/util.js';
import { fixWebmDuration } from './lib/webm-duration.js';

let engine = null;

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Carrera contra un timeout: evita que una captura colgada bloquee el inicio.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`tiempo agotado: ${label}`)), ms); });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(t)), timeout]);
}

// Detalle técnico de un error (las DOMException guardan la info en .name).
function errDetail(err) {
  if (!err) return 'error desconocido';
  const name = err.name || '';
  const msg = err.message || '';
  return (name && msg) ? `${name}: ${msg}` : (name || msg || String(err));
}

// Mensaje legible para el usuario, con pista según el tipo de fallo.
function friendlyError(err) {
  const hints = {
    NotReadableError: 'La pestaña o el micrófono están en uso por otra app, o falló el hardware.',
    NotAllowedError: 'Permiso de captura denegado.',
    NotFoundError: 'No se encontró el dispositivo de audio/captura.',
    InvalidStateError: 'La captura de la pestaña expiró o quedó en mal estado. Reintentá (recargá la pestaña si sigue).',
    AbortError: 'La captura se interrumpió. Reintentá.',
    OverconstrainedError: 'La calidad/dispositivo pedido no está disponible.',
  };
  const detail = errDetail(err);
  const hint = err && hints[err.name];
  return hint ? `${hint} (${detail})` : detail;
}

class Engine {
  constructor(opts) {
    this.streamId = opts.streamId;
    this.mode = opts.mode;                 // 'video' | 'audio'
    this.micDeviceId = opts.micDeviceId;
    this.echoCancellation = opts.echoCancellation;
    this.useFolder = opts.useFolder;
    this.recordingId = opts.recordingId;
    this.format = opts.format || 'webm';   // 'mp4' | 'webm'
    this.quality = QUALITY[opts.quality] ? opts.quality : 'medium';
    this.audioCopy = !!opts.audioCopy;

    this.outputs = [];
    this.startedAt = 0;
    this.pausedMs = 0;
    this._pauseStart = 0;
    this._paused = false;
    this._stopping = false;
    this._cleanedUp = false;
    this._finalDuration = 0;
    this.statsTimer = null;
    this.savedToFolder = false;
    this.micActive = false;
    this.micMuted = false;
    this._dirHandle = null;
  }

  async start() {
    const mode = this.mode;
    const q = QUALITY[this.quality];

    // 1) Captura de la pestaña con tope de resolución/fps del preset.
    const maxHeight = q.maxHeight;
    const maxWidth = Math.round((maxHeight * 16) / 9);
    this.tabStream = await withTimeout(navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: this.streamId } },
      video: mode === 'video'
        ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: this.streamId, maxWidth, maxHeight, maxFrameRate: q.maxFps } }
        : false,
    }), 10000, 'captura de la pestaña');

    // 2) Micrófono (opcional).
    this.micStream = null;
    if (this.micDeviceId && this.micDeviceId !== 'none') {
      const micConstraints = (deviceId) => ({
        audio: { deviceId, echoCancellation: this.echoCancellation, noiseSuppression: true, autoGainControl: true },
      });
      try {
        const exact = this.micDeviceId !== 'default' ? { exact: this.micDeviceId } : undefined;
        this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints(exact));
      } catch (err) {
        console.warn('Mic con el dispositivo elegido falló; reintento con el predeterminado.', err);
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints(undefined));
        } catch (err2) {
          console.warn('No se pudo abrir el micrófono; se graba solo la pestaña.', err2);
        }
      }
    }
    this.micActive = !!this.micStream;

    // 3) Mezcla con Web Audio.
    this.audioCtx = new AudioContext();
    const dest = this.audioCtx.createMediaStreamDestination();
    const tabSource = this.audioCtx.createMediaStreamSource(this.tabStream);
    tabSource.connect(dest);                       // pestaña → grabación
    tabSource.connect(this.audioCtx.destination);  // GOTCHA #1: pestaña → parlantes
    if (this.micStream) {
      const micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      micSource.connect(dest);                     // mic → grabación (no a parlantes)
    }
    const mixedAudioTrack = dest.stream.getAudioTracks()[0];

    // 4) ¿Carpeta con permiso vivo? (una sola resolución del handle).
    if (this.useFolder) {
      try {
        const h = await db.getSetting('dirHandle');
        if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') this._dirHandle = h;
      } catch (err) { console.warn('Carpeta no disponible.', err); }
    }
    this.savedToFolder = !!this._dirHandle;

    // 5) Salidas.
    const base = timestampBase();

    // principal
    const primaryTracks = [mixedAudioTrack];
    if (mode === 'video') primaryTracks.push(this.tabStream.getVideoTracks()[0]);
    await this._addOutput({
      id: this.recordingId,
      stream: new MediaStream(primaryTracks),
      mode, base, suffix: '',
      videoBps: mode === 'video' ? q.videoBps : 0,
    });

    // copia de solo audio (solo si se graba video)
    if (this.audioCopy && mode === 'video') {
      this._audioCloneTrack = mixedAudioTrack.clone(); // pista independiente para el 2º recorder
      await this._addOutput({
        id: `${this.recordingId}-audio`,
        stream: new MediaStream([this._audioCloneTrack]),
        mode: 'audio', base, suffix: 'audio',
        videoBps: 0,
      });
    }

    // Si cerrás la pestaña / cortás el compartido, detenemos.
    const primaryTrack = this.tabStream.getVideoTracks()[0] || this.tabStream.getAudioTracks()[0];
    primaryTrack?.addEventListener('ended', () => this.stop());

    // 6) Arrancar todos los recorders.
    this.startedAt = Date.now();
    for (const o of this.outputs) o.recorder.start(TIMESLICE_MS);
    this.statsTimer = setInterval(() => this._emitStats(), 1000);

    send({
      target: TARGET.POPUP, type: MSG.STARTED,
      recordingId: this.recordingId, mode,
      savedToFolder: this.savedToFolder, name: this.outputs[0].name,
      micActive: this.micActive, extraAudio: this.outputs.length > 1,
    });
    send({ target: TARGET.BG, type: MSG.STARTED, recordingId: this.recordingId, micActive: this.micActive });
  }

  async _addOutput({ id, stream, mode, base, suffix, videoBps }) {
    const { mime, ext, container } = pickMime(mode, this.format);
    const name = `${base}${suffix ? '-' + suffix : ''}.${ext}`;

    const sinks = [new IndexedDBSink(id)];
    // MP4 no necesita arreglo → se escribe incremental a la carpeta.
    // WebM se reescribe corregido (con duración) al finalizar, así que NO lo
    // escribimos incremental a disco (evita doble escritura y el archivo a medias).
    if (this._dirHandle && container !== 'webm') sinks.push(new FileSystemSink(this._dirHandle, name, mime));
    // v2 (servidor): sinks.push(new RemoteSink({ ... }))  — el resto no cambia.
    const manager = new SinkManager(sinks);

    await db.createRecording({
      id, createdAt: Date.now(), mode, mime, name,
      status: RECORDING_STATUS.RECORDING, durationMs: 0, bytes: 0,
      savedToFolder: !!this._dirHandle,
    });
    await manager.init({ recordingId: id, mime, mode, name });

    const recOpts = { mimeType: mime, audioBitsPerSecond: AUDIO_BPS };
    if (videoBps) recOpts.videoBitsPerSecond = videoBps;

    const recorder = new MediaRecorder(stream, recOpts);
    const output = { id, mode, mime, container, name, sinks: manager, recorder, stopped: false };
    recorder.ondataavailable = async (e) => { if (e.data && e.data.size > 0) await manager.writeChunk(e.data); };
    recorder.onstop = () => this._onOutputStop(output);
    recorder.onerror = (e) => this._fail(e.error || new Error('Error de MediaRecorder'));
    this.outputs.push(output);
  }

  elapsed() {
    const livePause = this._pauseStart ? Date.now() - this._pauseStart : 0;
    return Date.now() - this.startedAt - this.pausedMs - livePause;
  }

  totalBytes() {
    return this.outputs.reduce((s, o) => s + (o.sinks ? o.sinks.bytes : 0), 0);
  }

  _emitStats() {
    send({
      target: TARGET.POPUP, type: MSG.STATS,
      durationMs: this.elapsed(), bytes: this.totalBytes(),
      paused: this._paused, micActive: this.micActive, micMuted: this.micMuted,
    });
  }

  setMicMuted(muted) {
    this.micMuted = !!muted;
    this.micStream?.getAudioTracks().forEach((t) => { t.enabled = !this.micMuted; });
    this._emitStats();
  }

  pause() {
    if (this._paused) return;
    this._paused = true;
    this._pauseStart = Date.now();
    this.outputs.forEach((o) => { if (o.recorder.state === 'recording') o.recorder.pause(); });
    this._emitStats();
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.pausedMs += Date.now() - this._pauseStart;
    this._pauseStart = 0;
    this.outputs.forEach((o) => { if (o.recorder.state === 'paused') o.recorder.resume(); });
    this._emitStats();
  }

  stop() {
    if (this._stopping) return;
    this._stopping = true;
    this._finalDuration = this.elapsed();
    this.outputs.forEach((o) => {
      if (o.recorder.state !== 'inactive') o.recorder.stop();
      else this._onOutputStop(o);
    });
  }

  async _onOutputStop(o) {
    if (o.stopped) return;
    o.stopped = true;
    try { await o.sinks.finalize({ recordingId: o.id }); } catch (err) { console.warn('finalize', err); }

    // WebM → escribir el archivo de la carpeta una sola vez, con la duración
    // ya inyectada (queda con duración total y se puede saltar).
    if (this._dirHandle && o.container === 'webm') {
      try {
        const blob = await db.assembleBlob(o.id, o.mime);
        const fixed = await fixWebmDuration(blob, this._finalDuration);
        const fh = await this._dirHandle.getFileHandle(o.name, { create: true });
        const w = await fh.createWritable();
        await w.write(fixed);
        await w.close();
      } catch (err) { console.warn('No se pudo escribir el WebM corregido en la carpeta', err); }
    }

    await db.updateRecording(o.id, {
      status: RECORDING_STATUS.COMPLETED, durationMs: this._finalDuration, bytes: o.sinks.bytes,
    }).catch(() => {});
    if (this.outputs.every((x) => x.stopped)) this._finish();
  }

  _finish() {
    clearInterval(this.statsTimer);
    this._cleanup();
    const primary = this.outputs[0];
    send({
      target: TARGET.POPUP, type: MSG.STOPPED,
      recordingId: primary.id, durationMs: this._finalDuration, bytes: this.totalBytes(),
      savedToFolder: this.savedToFolder, name: primary.name, mime: primary.mime,
      extraAudio: this.outputs.length > 1,
    });
    send({ target: TARGET.BG, type: MSG.STOPPED, recordingId: primary.id });
    engine = null;
  }

  async _fail(err) {
    clearInterval(this.statsTimer);
    for (const o of this.outputs) {
      try { await o.sinks.abort(); } catch {}
      await db.updateRecording(o.id, { status: RECORDING_STATUS.ERROR }).catch(() => {});
    }
    this._cleanup();
    console.warn('offscreen _fail:', err?.name, err?.message);
    const message = friendlyError(err);
    send({ target: TARGET.POPUP, type: MSG.ERROR, message });
    send({ target: TARGET.BG, type: MSG.ERROR, message });
    engine = null;
  }

  _cleanup() {
    if (this._cleanedUp) return;   // idempotente: puede llamarse desde _finish y _fail
    this._cleanedUp = true;
    this.tabStream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());
    this._audioCloneTrack?.stop();
    // Cerrar el AudioContext de forma 100% segura: close() puede lanzar
    // sincrónicamente o devolver una promesa que rechaza si ya está cerrado.
    // Envolviéndolo en una promesa, cualquier error (sync o async) cae en .catch.
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (ctx && ctx.state !== 'closed') {
      Promise.resolve().then(() => ctx.close()).catch(() => {});
    }
  }
}

// ── enrutador de mensajes ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== TARGET.OFFSCREEN) return;

  (async () => {
    try {
      switch (msg.type) {
        case MSG.OFFSCREEN_START:
          // Si quedó un engine zombi (fallo previo), lo desmantelamos antes.
          if (engine) {
            try { engine.stop(); } catch {}
            try { engine._cleanup(); } catch {}
            engine = null;
          }
          engine = new Engine(msg);
          await engine.start();
          sendResponse({ ok: true });
          break;
        case MSG.OFFSCREEN_STOP:
          engine?.stop();
          sendResponse({ ok: true });
          break;
        case MSG.OFFSCREEN_PAUSE:
          engine?.pause();
          sendResponse({ ok: true });
          break;
        case MSG.OFFSCREEN_RESUME:
          engine?.resume();
          sendResponse({ ok: true });
          break;
        case MSG.OFFSCREEN_MUTE:
          engine?.setMicMuted(msg.muted);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'tipo desconocido' });
      }
    } catch (err) {
      console.error('offscreen error:', err?.name, '-', err?.message, err);
      if (engine) engine._fail(err);
      else send({ target: TARGET.POPUP, type: MSG.ERROR, message: friendlyError(err) });
      sendResponse({ ok: false, error: friendlyError(err) });
    }
  })();

  return true;
});
