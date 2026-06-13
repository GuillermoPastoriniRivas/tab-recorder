// Utilidades puras compartidas por todos los contextos.

/** Base del nombre sin extensión: meet-2026-06-11_15-30-05 */
export function timestampBase(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `meet-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Nombre de archivo con marca de tiempo: meet-2026-06-11_15-30-05.webm */
export function timestampName(ext = 'webm', d = new Date()) {
  return `${timestampBase(d)}.${ext}`;
}

/** ms → "12:34" o "1:02:03" */
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** bytes → "12.3 MB" */
export function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(1)} ${u[i]}`;
}

/** timestamp ms → "11 jun 2026, 15:30" */
export function formatDate(ms) {
  try {
    return new Date(ms).toLocaleString('es', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}

// Candidatos por (modo, contenedor), de más a menos específico.
const MIME_SETS = {
  'video:mp4':  ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'],
  'audio:mp4':  ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
  'video:webm': ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  'audio:webm': ['audio/webm;codecs=opus', 'audio/webm'],
};

function isSupported(t) {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);
}

/** ¿El navegador puede grabar MP4 (H.264/AAC) con MediaRecorder? */
export function mp4Supported() {
  return MIME_SETS['video:mp4'].some(isSupported);
}

/**
 * Elige mime + extensión para (modo, formato pedido), cayendo al otro
 * contenedor si el pedido no está soportado.
 * @returns {{mime:string, ext:string, container:'mp4'|'webm'}}
 */
export function pickMime(mode, format = 'webm') {
  const order = [`${mode}:${format}`, `${mode}:${format === 'mp4' ? 'webm' : 'mp4'}`];
  for (const key of order) {
    for (const t of MIME_SETS[key]) {
      if (isSupported(t)) {
        const container = key.endsWith('mp4') ? 'mp4' : 'webm';
        const ext = container === 'mp4' ? (mode === 'audio' ? 'm4a' : 'mp4') : 'webm';
        return { mime: t, ext, container };
      }
    }
  }
  return { mime: mode === 'audio' ? 'audio/webm' : 'video/webm', ext: 'webm', container: 'webm' };
}
