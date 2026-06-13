"""Transcripción con faster-whisper.

faster-whisper decodifica el audio internamente con PyAV, así que le
pasamos el MP4 directo: no hace falta ffmpeg externo ni extraer el audio
a un WAV aparte.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from . import config

# El modelo se carga una sola vez y se reusa entre jobs (cargarlo es caro).
_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            config.WHISPER_MODEL_SIZE,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE_TYPE,
            download_root=str(config.WHISPER_DIR),
        )
    return _model


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    language: str
    duration: float
    text: str
    segments: list[TranscriptSegment] = field(default_factory=list)


# progress_cb(fraction: float, message: str) -> None
ProgressCb = Optional[Callable[[float, str], None]]


def transcribe(media_path: str, progress_cb: ProgressCb = None) -> TranscriptResult:
    """Transcribe un archivo de audio/video. `media_path` puede ser un MP4.

    Llama a progress_cb con una fracción 0..1 a medida que avanza, estimada
    sobre la duración total del audio.
    """
    model = _get_model()

    # language=None → autodetección (sirve para reuniones ES/EN mezcladas).
    # vad_filter recorta silencios y acelera bastante en CPU.
    segments_iter, info = model.transcribe(
        media_path,
        language=None,
        vad_filter=True,
        beam_size=5,
    )

    total = info.duration or 0.0
    segments: list[TranscriptSegment] = []
    parts: list[str] = []

    if progress_cb:
        progress_cb(0.0, f"Idioma detectado: {info.language}")

    for seg in segments_iter:
        segments.append(TranscriptSegment(start=seg.start, end=seg.end, text=seg.text.strip()))
        parts.append(seg.text.strip())
        if progress_cb and total > 0:
            frac = min(0.99, seg.end / total)
            progress_cb(frac, "Transcribiendo…")

    if progress_cb:
        progress_cb(1.0, "Transcripción completa")

    return TranscriptResult(
        language=info.language,
        duration=total,
        text=" ".join(parts).strip(),
        segments=segments,
    )
