"""Descarga de modelos en el primer arranque.

El instalador es liviano: los modelos (Whisper small + Qwen2.5 3B GGUF) se
bajan acá la primera vez y quedan cacheados en %LOCALAPPDATA%\\WhisperMeet.
"""
from __future__ import annotations

from typing import Callable, Optional

from . import config

ProgressCb = Optional[Callable[[float, str], None]]


def whisper_ready() -> bool:
    # faster-whisper guarda el modelo en subcarpetas con un model.bin dentro.
    return any(config.WHISPER_DIR.rglob("model.bin"))


def llm_ready() -> bool:
    return config.LLM_PATH.exists() and config.LLM_PATH.stat().st_size > 0


def models_ready() -> bool:
    return whisper_ready() and llm_ready()


def _download_whisper(progress_cb: ProgressCb) -> None:
    if whisper_ready():
        return
    if progress_cb:
        progress_cb(0.0, "Descargando modelo de transcripción (Whisper small)…")
    from faster_whisper import download_model

    download_model(config.WHISPER_MODEL_SIZE, output_dir=str(config.WHISPER_DIR))
    if progress_cb:
        progress_cb(1.0, "Whisper listo")


def _download_llm(progress_cb: ProgressCb) -> None:
    if llm_ready():
        return
    if progress_cb:
        progress_cb(0.0, "Descargando modelo de resumen (Qwen2.5 3B, ~2GB)…")
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(
        repo_id=config.LLM_REPO,
        filename=config.LLM_FILENAME,
        local_dir=str(config.LLM_DIR),
    )
    # hf_hub_download puede dejarlo en una ruta anidada; aseguramos LLM_PATH.
    from pathlib import Path

    p = Path(path)
    if p.resolve() != config.LLM_PATH.resolve():
        config.LLM_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            if config.LLM_PATH.exists():
                config.LLM_PATH.unlink()
            p.replace(config.LLM_PATH)
        except OSError:
            # Si no se puede mover (otro filesystem), copiamos.
            import shutil

            shutil.copy2(p, config.LLM_PATH)
    if progress_cb:
        progress_cb(1.0, "Modelo de resumen listo")


def ensure_models(progress_cb: ProgressCb = None) -> None:
    """Garantiza que ambos modelos estén disponibles localmente."""
    _download_whisper(progress_cb)
    _download_llm(progress_cb)
    if progress_cb:
        progress_cb(1.0, "Modelos listos")
