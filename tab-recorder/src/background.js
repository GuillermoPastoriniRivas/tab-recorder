// Service worker: orquesta el ciclo de vida del documento offscreen,
// mantiene el estado de la grabación y refleja "REC" en el badge del ícono.
//
// Nota: el offscreen sobrevive aunque el SW sea suspendido por Chrome, así que
// la grabación NO se interrumpe. El estado vive en chrome.storage.session para
// sobrevivir reinicios del SW dentro de la misma sesión del navegador.

import { MSG, TARGET } from './lib/messages.js';

const OFFSCREEN_URL = 'src/offscreen.html';

// ── estado en session storage ────────────────────────────────────────────
async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state || { status: 'idle' };
}
async function setState(state) {
  await chrome.storage.session.set({ state });
}

// ── badge "REC" ────────────────────────────────────────────────────────────
async function setBadge(on) {
  await chrome.action.setBadgeText({ text: on ? 'REC' : '' });
  if (on) await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
}

// ── ciclo de vida del offscreen ─────────────────────────────────────────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    // USER_MEDIA → captura de pestaña/mic vía getUserMedia.
    // AUDIO_PLAYBACK → re-emitir el audio de la pestaña a los parlantes (gotcha #1).
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Capturar la pestaña y el micrófono para grabar la reunión.',
  });
}
async function closeOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch (err) {
    console.warn('No se pudo cerrar el offscreen', err);
  }
}

// El offscreen puede tardar un instante en registrar su listener tras crearse:
// reintentamos el START unas pocas veces.
async function startInOffscreen(payload) {
  for (let i = 0; i < 12; i++) {
    try {
      const resp = await chrome.runtime.sendMessage(payload);
      if (resp) return resp;
    } catch {
      // listener todavía no disponible
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, error: 'El motor de grabación (offscreen) no respondió.' };
}

// ── enrutador de mensajes ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== TARGET.BG) return; // no es para el background

  (async () => {
    switch (msg.type) {
      case MSG.START: {
        const st = await getState();
        if (st.status === 'recording') { sendResponse({ ok: false, error: 'Ya hay una grabación en curso.' }); break; }
        const recordingId = crypto.randomUUID();
        // Siempre desde un offscreen LIMPIO: si quedó uno zombi de un fallo previo,
        // cerrarlo destruye sus streams → libera la captura y des-mutea la pestaña.
        await closeOffscreen();
        await ensureOffscreen();
        const resp = await startInOffscreen({
          target: TARGET.OFFSCREEN,
          type: MSG.OFFSCREEN_START,
          recordingId,
          streamId: msg.streamId,
          mode: msg.mode,
          micDeviceId: msg.micDeviceId,
          echoCancellation: msg.echoCancellation,
          useFolder: msg.useFolder,
          format: msg.format,
          quality: msg.quality,
          audioCopy: msg.audioCopy,
        });
        if (resp.ok) {
          await setState({ status: 'recording', startedAt: Date.now(), paused: false, recordingId, micActive: false, micMuted: false });
          await setBadge(true);
          sendResponse({ ok: true, recordingId });
        } else {
          await closeOffscreen();
          await setState({ status: 'idle' });
          await setBadge(false);
          sendResponse({ ok: false, error: resp.error });
        }
        break;
      }

      case MSG.CANCEL: {
        // Aborta/limpia: cierra el offscreen (libera la captura) y resetea.
        await closeOffscreen();
        await setState({ status: 'idle' });
        await setBadge(false);
        sendResponse({ ok: true });
        break;
      }

      case MSG.STOP:
        await chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type: MSG.OFFSCREEN_STOP }).catch(() => {});
        sendResponse({ ok: true });
        break;

      case MSG.PAUSE: {
        await chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type: MSG.OFFSCREEN_PAUSE }).catch(() => {});
        const s = await getState();
        await setState({ ...s, paused: true });
        sendResponse({ ok: true });
        break;
      }

      case MSG.RESUME: {
        await chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type: MSG.OFFSCREEN_RESUME }).catch(() => {});
        const s = await getState();
        await setState({ ...s, paused: false });
        sendResponse({ ok: true });
        break;
      }

      case MSG.MUTE: {
        await chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type: MSG.OFFSCREEN_MUTE, muted: msg.muted }).catch(() => {});
        const s = await getState();
        await setState({ ...s, micMuted: !!msg.muted });
        sendResponse({ ok: true });
        break;
      }

      case MSG.GET_STATE:
        sendResponse(await getState());
        break;

      // ── avisos que llegan del offscreen ──
      case MSG.STARTED: {
        const s = await getState();
        if (s.status === 'recording') await setState({ ...s, micActive: !!msg.micActive });
        sendResponse({ ok: true });
        break;
      }

      case MSG.STOPPED:
      case MSG.ERROR:
        await setState({ status: 'idle' });
        await setBadge(false);
        await closeOffscreen();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: 'tipo desconocido' });
    }
  })();

  return true; // respondemos de forma asíncrona
});

// Al instalar/arrancar, limpiamos badge y estado colgado.
chrome.runtime.onStartup.addListener(async () => {
  await setState({ status: 'idle' });
  await setBadge(false);
});
chrome.runtime.onInstalled.addListener(async () => {
  await setBadge(false);
});
