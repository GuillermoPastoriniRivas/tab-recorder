// Configuración central de la extensión.

export const DB_NAME = 'meet-recorder';
export const DB_VERSION = 1;

export const STORE_CHUNKS = 'chunks';
export const STORE_RECORDINGS = 'recordings';
export const STORE_SETTINGS = 'settings';

// Cada cuánto MediaRecorder emite un trozo (chunk). 3s = streaming a disco/IDB
// sin acumular toda la grabación en RAM (clave para reuniones largas).
export const TIMESLICE_MS = 3000;

export const DEFAULT_SETTINGS = {
  mode: 'video',          // 'video' | 'audio'
  micDeviceId: 'default',  // deviceId | 'none'
  echoCancellation: true,
  format: 'mp4',          // 'mp4' | 'webm' (cae a webm si el navegador no soporta MP4)
  quality: 'medium',      // 'high' | 'medium' | 'low'
  audioCopy: false,       // además del video, guardar una copia de solo audio
};

// Presets de calidad: tope de resolución, fps y bitrate de video.
// El peso se domina con esto (ver README). Audio siempre a AUDIO_BPS.
export const QUALITY = {
  high:   { label: 'Alta',  maxHeight: 1080, maxFps: 30, videoBps: 2_500_000 },
  medium: { label: 'Media', maxHeight: 720,  maxFps: 24, videoBps: 1_000_000 },
  low:    { label: 'Baja',  maxHeight: 540,  maxFps: 15, videoBps: 600_000 },
};

export const AUDIO_BPS = 128_000;

export const RECORDING_STATUS = {
  RECORDING: 'recording',
  COMPLETED: 'completed',
  ERROR: 'error',
};
