// Protocolo de mensajes entre contextos (popup ⇄ service worker ⇄ offscreen).
// Cada mensaje lleva un `target` para que cada contexto ignore lo que no es suyo,
// ya que chrome.runtime.sendMessage difunde a TODOS los contextos de la extensión.

export const TARGET = {
  BG: 'background',
  OFFSCREEN: 'offscreen',
  POPUP: 'popup',
};

export const MSG = {
  // popup → background
  START: 'START_RECORDING',
  STOP: 'STOP_RECORDING',
  PAUSE: 'PAUSE_RECORDING',
  RESUME: 'RESUME_RECORDING',
  MUTE: 'MUTE_MIC',
  CANCEL: 'CANCEL_RECORDING',   // abortar/limpiar (cierra offscreen, libera captura)
  GET_STATE: 'GET_STATE',

  // background → offscreen
  OFFSCREEN_START: 'OFFSCREEN_START',
  OFFSCREEN_STOP: 'OFFSCREEN_STOP',
  OFFSCREEN_PAUSE: 'OFFSCREEN_PAUSE',
  OFFSCREEN_RESUME: 'OFFSCREEN_RESUME',
  OFFSCREEN_MUTE: 'OFFSCREEN_MUTE',

  // permission.html → popup
  MIC_GRANTED: 'MIC_GRANTED',

  // offscreen → background / popup
  STARTED: 'RECORDING_STARTED',
  STOPPED: 'RECORDING_STOPPED',
  ERROR: 'RECORDING_ERROR',
  STATS: 'RECORDING_STATS',
};
