// ─────────────────────────────────────────────────────────────────────────
//  CLIENTE DEL BACKEND LOCAL (WhisperMeet)
//
//  Habla con el servicio local headless (app de bandeja) que corre en
//  127.0.0.1:8765 y hace transcripción (Whisper) + resumen (Qwen2.5 3B).
//
//  Flujo:
//    1) pair()        → obtiene y cachea el token (1ª vez).
//    2) POST /process → sube el Blob del video, devuelve job_id.
//    3) SSE /stream   → progreso en vivo (download/transcribe/summarize).
//    4) result        → llega en el evento 'done'.
//
//  Seguridad: el backend escucha solo en localhost, restringe CORS a
//  orígenes chrome-extension:// y exige el token en cada request.
// ─────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://127.0.0.1:8765';
const TOKEN_KEY = 'wm_token';

// Instalador del backend (servicio local). URL estable a la última Release:
// siempre sirve el último WhisperMeet-Setup.exe publicado por el CI.
export const BACKEND_DOWNLOAD_URL =
  'https://github.com/GuillermoPastoriniRivas/tab-recorder/releases/latest/download/WhisperMeet-Setup.exe';

// ── token / pairing ──────────────────────────────────────────────────────
async function getToken() {
  const { [TOKEN_KEY]: cached } = await chrome.storage.local.get(TOKEN_KEY);
  if (cached) return cached;
  const res = await fetch(`${BACKEND}/pair`);
  if (!res.ok) throw new Error(`No se pudo emparejar con el backend (${res.status})`);
  const { token } = await res.json();
  if (!token) throw new Error('El backend no devolvió un token');
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
  return token;
}

// Si el token quedó viejo (reinstalaron el backend), lo borramos para repedir.
async function resetToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
}

// ── estado del backend ───────────────────────────────────────────────────
// Devuelve {status, version, models_ready} o null si no está corriendo.
export async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/health`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ── job ──────────────────────────────────────────────────────────────────
async function startJob(blob, filename, token) {
  const fd = new FormData();
  fd.append('file', blob, filename || 'grabacion.mp4');
  const res = await fetch(`${BACKEND}/process`, {
    method: 'POST',
    headers: { 'X-WhisperMeet-Token': token },
    body: fd,
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`El backend rechazó el archivo (${res.status})`);
  return (await res.json()).job_id;
}

function streamJob(jobId, token, onEvent) {
  return new Promise((resolve, reject) => {
    const url = `${BACKEND}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      onEvent(data);
      if (data.type === 'done') { es.close(); resolve(data.result); }
      else if (data.type === 'error') { es.close(); reject(new Error(data.message || 'Error en el backend')); }
    };
    es.onerror = () => { es.close(); reject(new Error('Se interrumpió la conexión con el backend')); };
  });
}

// ── API pública ──────────────────────────────────────────────────────────
// transcribeRecording(blob, filename, onEvent) → Promise<result>
//   result = { language, duration, has_speech, transcript, summary, output_path }
//   onEvent(ev) recibe {type:'progress', stage, fraction, message} en vivo.
export async function transcribeRecording(blob, filename, onEvent) {
  let token = await getToken();
  let jobId;
  try {
    jobId = await startJob(blob, filename, token);
  } catch (err) {
    if (err.message === 'UNAUTHORIZED') {
      // Token viejo → reemparejamos una vez y reintentamos.
      await resetToken();
      token = await getToken();
      jobId = await startJob(blob, filename, token);
    } else {
      throw err;
    }
  }
  return streamJob(jobId, token, onEvent);
}
