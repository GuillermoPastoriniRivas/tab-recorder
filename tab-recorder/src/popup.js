import { MSG, TARGET } from './lib/messages.js';
import { DEFAULT_SETTINGS, QUALITY, AUDIO_BPS } from './lib/constants.js';
import { db } from './lib/db.js';
import { formatDuration, formatBytes, mp4Supported } from './lib/util.js';

const $ = (id) => document.getElementById(id);
const el = {
  openManager: $('openManager'), configFolder: $('configFolder'), folderName: $('folderName'),
  setupCard: $('setupCard'), liveCard: $('liveCard'), resultCard: $('resultCard'),
  modeSeg: $('modeSeg'), mic: $('mic'), meterCanvas: $('meterCanvas'), enableMic: $('enableMic'),
  echo: $('echo'),
  advToggle: $('advToggle'), advPanel: $('advPanel'),
  formatSeg: $('formatSeg'), qualitySeg: $('qualitySeg'), audioCopy: $('audioCopy'),
  formatNote: $('formatNote'), qualityNote: $('qualityNote'),
  start: $('start'), pause: $('pause'), resume: $('resume'), stop: $('stop'),
  muteMic: $('muteMic'), muteLabel: $('muteLabel'),
  liveTimer: $('liveTimer'), liveSize: $('liveSize'), liveLabel: $('liveLabel'), equalizer: $('equalizer'),
  resultText: $('resultText'), save: $('save'), newRec: $('newRec'),
};

let mode = DEFAULT_SETTINGS.mode;
let format = DEFAULT_SETTINGS.format;
let quality = DEFAULT_SETTINGS.quality;
let meterStream = null, meterCtx = null, meterRAF = null;
let lastRecordingId = null;
let localTimer = null;
let stopWatchdog = null;
let micPermStatus = null;
const MP4_OK = mp4Supported();

// ── ajustes ──────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = (await db.getSetting('settings')) || DEFAULT_SETTINGS;
  setMode(s.mode || 'video');
  el.echo.checked = s.echoCancellation !== false;
  setFormat(s.format || DEFAULT_SETTINGS.format);
  setQuality(s.quality || DEFAULT_SETTINGS.quality);
  el.audioCopy.checked = !!s.audioCopy;
  updateFormatNote();
  await refreshFolderStatus();
  return s;
}

// Refleja si la carpeta tiene permiso vivo. El permiso de File System Access se
// reinicia al recargar la extensión / reiniciar Chrome; ahí hay que reactivarlo.
async function refreshFolderStatus() {
  const dir = await db.getSetting('dirHandle');
  if (!dir) {
    el.folderName.textContent = 'Se pedirá al guardar';
    el.folderName.className = 'hint muted';
    el.configFolder.textContent = 'Configurar';
    return;
  }
  let perm = 'prompt';
  try { perm = await dir.queryPermission({ mode: 'readwrite' }); } catch {}
  if (perm === 'granted') {
    el.folderName.textContent = `📁 ${dir.name}`;
    el.folderName.className = 'hint';
    el.configFolder.textContent = 'Cambiar';
  } else {
    el.folderName.textContent = `📁 ${dir.name} · sin permiso`;
    el.folderName.className = 'hint warn';
    el.configFolder.textContent = 'Reactivar';
  }
}
async function persistSettings() {
  await db.setSetting('settings', {
    mode,
    micDeviceId: el.mic.value,
    echoCancellation: el.echo.checked,
    format,
    quality,
    audioCopy: el.audioCopy.checked,
  });
}

function setMode(m) {
  mode = m;
  el.modeSeg.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
}
el.modeSeg.querySelectorAll('.seg').forEach((b) => {
  b.onclick = () => { setMode(b.dataset.mode); persistSettings(); };
});
el.echo.onchange = persistSettings;
el.mic.onchange = persistSettings;

// ── opciones avanzadas: formato / calidad / copia de audio ──
function setFormat(f) {
  format = (f === 'mp4' && !MP4_OK) ? 'webm' : f;
  el.formatSeg.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.format === format));
}
function setQuality(qk) {
  quality = QUALITY[qk] ? qk : 'medium';
  el.qualitySeg.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.quality === quality));
  el.qualityNote.textContent = qualityHint(quality);
}
function qualityHint(qk) {
  const q = QUALITY[qk];
  const mb = Math.round(((q.videoBps + AUDIO_BPS) / 8) * 1800 / 1e6); // estimado 30 min
  const mbps = (q.videoBps / 1e6).toFixed(q.videoBps >= 1e6 ? 1 : 2);
  return `${q.maxHeight}p · ${q.maxFps} fps · ~${mbps} Mbps · ~${mb} MB / 30 min`;
}
function updateFormatNote() {
  if (!MP4_OK) el.formatNote.textContent = 'MP4 no disponible en este navegador; se usará WebM.';
  else if (format === 'mp4') el.formatNote.textContent = 'MP4 (H.264): reproduce en todos lados, permite saltar y ver duración.';
  else el.formatNote.textContent = 'WebM (VP9): archivos más chicos, pero menos compatible.';
}

el.formatSeg.querySelectorAll('.seg').forEach((b) => {
  b.onclick = () => { if (b.disabled) return; setFormat(b.dataset.format); updateFormatNote(); persistSettings(); };
});
el.qualitySeg.querySelectorAll('.seg').forEach((b) => {
  b.onclick = () => { setQuality(b.dataset.quality); persistSettings(); };
});
el.audioCopy.onchange = persistSettings;

el.advToggle.onclick = () => {
  const willOpen = el.advPanel.hidden;
  el.advPanel.hidden = !willOpen;
  el.advToggle.classList.toggle('open', willOpen);
};

// ── micrófono: permiso, lista y waveform ───────────────────────────────────
async function initMic() {
  // Observamos el permiso una sola vez: si cambia (p.ej. lo concedés en la
  // ventana de permiso) re-ejecutamos initMic y el mic aparece solo, sin reabrir.
  if (!micPermStatus) {
    try {
      micPermStatus = await navigator.permissions.query({ name: 'microphone' });
      micPermStatus.onchange = () => initMic();
    } catch { /* Permissions API no disponible */ }
  }
  const state = micPermStatus ? micPermStatus.state : 'prompt';

  if (state === 'granted') {
    try {
      meterStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      el.enableMic.hidden = true;
      await populateMics();
      startMeter(meterStream);
      return;
    } catch { /* permiso revocado entre la consulta y el uso */ }
  }

  // No pedimos getUserMedia desde el popup: el prompt le quita el foco al popup
  // y lo cierra, abortando todo. Mostramos el botón → ventana dedicada.
  el.mic.innerHTML = '';
  el.mic.add(new Option('Permití el micrófono primero', 'none'));
  el.enableMic.hidden = false;
  el.enableMic.textContent = state === 'denied' ? 'Micrófono bloqueado — gestionar' : 'Permitir micrófono';
}

async function populateMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const saved = (await db.getSetting('settings'))?.micDeviceId;
  el.mic.innerHTML = '';
  el.mic.add(new Option('Sin micrófono (solo pestaña)', 'none'));
  mics.forEach((d, i) => el.mic.add(new Option(d.label || `Micrófono ${i + 1}`, d.deviceId)));
  if (saved && [...el.mic.options].some((o) => o.value === saved)) el.mic.value = saved;
}

function startMeter(stream) {
  stopMeter(false);
  meterCtx = new AudioContext();
  const src = meterCtx.createMediaStreamSource(stream);
  const an = meterCtx.createAnalyser();
  an.fftSize = 128;
  src.connect(an);
  const data = new Uint8Array(an.frequencyBinCount);
  const cvs = el.meterCanvas;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  const BARS = 32, GAP = 3;
  const bw = (W - GAP * (BARS - 1)) / BARS;

  const draw = () => {
    an.getByteFrequencyData(data);
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#6d6bff');
    grad.addColorStop(1, '#c264ff');
    ctx.fillStyle = grad;
    for (let i = 0; i < BARS; i++) {
      const v = data[Math.floor(i * data.length / BARS)] / 255;
      const bh = Math.max(2, v * H);
      const x = i * (bw + GAP);
      ctx.beginPath();
      ctx.roundRect(x, H - bh, bw, bh, 2);
      ctx.fill();
    }
    meterRAF = requestAnimationFrame(draw);
  };
  draw();
}

function stopMeter(stopTracks = true) {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  const ctx = meterCtx;
  meterCtx = null;
  if (ctx && ctx.state !== 'closed') Promise.resolve().then(() => ctx.close()).catch(() => {});
  if (stopTracks) { meterStream?.getTracks().forEach((t) => t.stop()); meterStream = null; }
}

el.enableMic.onclick = () => {
  // Ventana real (no el popup): el prompt de permiso funciona y no se cierra sola.
  chrome.windows.create({
    url: chrome.runtime.getURL('src/permission.html'),
    type: 'popup', width: 460, height: 360,
  });
};

// ── carpeta / gestor ────────────────────────────────────────────────────
function openManager(id) {
  const url = chrome.runtime.getURL('src/manager.html') + (id ? `?id=${id}` : '');
  chrome.tabs.create({ url });
}
el.openManager.onclick = () => openManager();
el.configFolder.onclick = () => openManager();   // elegir carpeta vive en el gestor (los diálogos cierran el popup)

// ── máquina de estados de la UI ────────────────────────────────────────────
function showCard(name) {
  el.setupCard.hidden = name !== 'setup';
  el.liveCard.hidden = name !== 'live';
  el.resultCard.hidden = name !== 'result';
  // El punto rojo del logo se muestra solo mientras se graba (card 'live').
  document.querySelector('.logo')?.classList.toggle('recording', name === 'live');
}

function renderState(state) {
  if (state?.status === 'recording') {
    showCard('live');
    stopMeter();
    setPaused(!!state.paused);
    renderMic(state.micActive, state.micMuted);
    // arranque inmediato del cronómetro a partir de startedAt
    if (state.startedAt) tickFrom(state.startedAt, state.paused);
  } else {
    showCard('setup');
  }
}

function setPaused(paused) {
  el.pause.hidden = paused;
  el.resume.hidden = !paused;
  el.liveLabel.textContent = paused ? 'EN PAUSA' : 'GRABANDO';
  el.equalizer.classList.toggle('paused', paused);
}

function renderMic(active, muted) {
  el.muteMic.hidden = !active;            // sin mic en la grabación → no mostramos el toggle
  el.muteMic.classList.toggle('muted', !!muted);
  el.muteLabel.textContent = muted ? 'Micrófono silenciado' : 'Silenciar mi micrófono';
}

function tickFrom(startedAt, paused) {
  clearInterval(localTimer);
  const update = () => { el.liveTimer.textContent = formatDuration(Date.now() - startedAt); };
  update();
  if (!paused) localTimer = setInterval(update, 1000);
}

// ── controles ─────────────────────────────────────────────────────────────
// Carrera contra timeout: garantiza que ninguna espera deje el botón colgado.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`tiempo agotado (${label})`)), ms); });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(t)), timeout]);
}
// Pide al background que limpie todo (cierra offscreen → libera la captura).
function cancelInBg() {
  return chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.CANCEL }).catch(() => {});
}

el.start.onclick = async () => {
  el.start.disabled = true;
  try {
    await persistSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { alert('No hay una pestaña activa para grabar.'); return; }
    if (tab.url && !/^https?:/.test(tab.url)) {
      alert('Solo se pueden grabar pestañas web (https). Abrí tu reunión de Meet y reintentá.');
      return;
    }

    // ¿hay carpeta con permiso ya concedido? (el permiso se pide en el gestor)
    let useFolder = false;
    const dir = await db.getSetting('dirHandle');
    if (dir) {
      try { useFolder = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch {}
    }

    let streamId;
    try {
      streamId = await withTimeout(chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }), 8000, 'capturar la pestaña');
    } catch (err) {
      await cancelInBg();
      alert('No se pudo capturar la pestaña. Si venís de un corte (cámara/captura trabada), recargá la pestaña de Meet y reintentá.\n\n(' + (err?.message || err) + ')');
      return;
    }

    let resp;
    try {
      resp = await withTimeout(chrome.runtime.sendMessage({
        target: TARGET.BG, type: MSG.START,
        streamId, mode, micDeviceId: el.mic.value, echoCancellation: el.echo.checked, useFolder,
        format, quality, audioCopy: el.audioCopy.checked,
      }), 15000, 'iniciar la grabación');
    } catch (err) {
      await cancelInBg();
      alert('La grabación no arrancó a tiempo; se liberó la captura. Reintentá.\n\n(' + (err?.message || err) + ')');
      return;
    }

    if (!resp?.ok) { await cancelInBg(); alert('Error al iniciar: ' + (resp?.error || 'desconocido')); return; }

    renderState({ status: 'recording', startedAt: Date.now(), paused: false });
  } catch (err) {
    await cancelInBg();
    alert('Error inesperado al iniciar: ' + (err?.message || err));
  } finally {
    el.start.disabled = false;
  }
};

el.stop.onclick = () => {
  clearInterval(localTimer);
  el.stop.disabled = true;
  chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.STOP }).catch(() => {});
  // Watchdog: si en 7s no llegó la confirmación (offscreen muerto), forzamos
  // limpieza y volvemos a la pantalla de inicio en vez de quedar trabados.
  clearTimeout(stopWatchdog);
  stopWatchdog = setTimeout(async () => {
    await cancelInBg();
    el.stop.disabled = false;
    showCard('setup');
    initMic();
  }, 7000);
};
el.pause.onclick = () => { chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.PAUSE }); setPaused(true); clearInterval(localTimer); };
el.resume.onclick = () => { chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.RESUME }); };
el.muteMic.onclick = () => {
  const willMute = !el.muteMic.classList.contains('muted');
  chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.MUTE, muted: willMute });
  renderMic(true, willMute); // feedback optimista; el offscreen confirma por STATS
};

el.save.onclick = () => openManager(lastRecordingId);
el.newRec.onclick = async () => { showCard('setup'); await initMic(); };

// ── mensajes del offscreen ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== TARGET.POPUP) return;
  if (msg.type === MSG.STATS) {
    el.liveSize.textContent = formatBytes(msg.bytes);
    el.liveTimer.textContent = formatDuration(msg.durationMs);
    setPaused(!!msg.paused);
    renderMic(msg.micActive, msg.micMuted);
    if (!msg.paused) clearInterval(localTimer); // STATS ya manda el tiempo exacto
  } else if (msg.type === MSG.MIC_GRANTED) {
    initMic(); // se concedió el permiso desde la ventana → refrescamos en vivo
  } else if (msg.type === MSG.STARTED) {
    renderState({ status: 'recording', startedAt: Date.now(), paused: false });
    renderMic(msg.micActive, false); // mostrar el toggle ya, sin esperar al primer STATS
    if (!msg.micActive && el.mic.value !== 'none') {
      alert('⚠ No se pudo activar el micrófono: se está grabando SOLO la pestaña.\n\nRevisá el permiso (botón "Permitir micrófono") o elegí otro dispositivo, y volvé a empezar.');
    }
  } else if (msg.type === MSG.STOPPED) {
    onStopped(msg);
  } else if (msg.type === MSG.ERROR) {
    clearTimeout(stopWatchdog);
    el.stop.disabled = false;
    showCard('setup');
    initMic();
    alert('Error de grabación: ' + msg.message);
  }
});

function onStopped(msg) {
  clearInterval(localTimer);
  clearTimeout(stopWatchdog);
  el.stop.disabled = false;
  lastRecordingId = msg.recordingId;
  showCard('result');
  const extra = msg.extraAudio ? ' · incluye copia de audio' : '';
  const meta = `${formatDuration(msg.durationMs)} · ${formatBytes(msg.bytes)}${extra}`;
  el.resultText.innerHTML = msg.savedToFolder
    ? `Guardada en tu carpeta ✓<br><span style="color:var(--txt-mute)">${msg.name} · ${meta}</span>`
    : `Grabación lista · ${meta}<br><span style="color:var(--txt-mute)">Abrí el gestor para guardarla en disco</span>`;
}

// ── init ───────────────────────────────────────────────────────────────────
(async () => {
  if (!MP4_OK) {
    const b = el.formatSeg.querySelector('[data-format="mp4"]');
    if (b) b.disabled = true;
  }
  await loadSettings();
  const state = await chrome.runtime.sendMessage({ target: TARGET.BG, type: MSG.GET_STATE }).catch(() => ({ status: 'idle' }));
  renderState(state || { status: 'idle' });
  if (state?.status !== 'recording') await initMic();
})();

// Si el popup recupera el foco (p.ej. tras reactivar la carpeta en el gestor),
// refrescamos el estado de la carpeta.
window.addEventListener('focus', () => { refreshFolderStatus(); });
window.addEventListener('unload', () => stopMeter());
