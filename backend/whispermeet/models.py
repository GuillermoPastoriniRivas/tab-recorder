"""Descarga de modelos en el primer arranque.

El instalador es liviano: los modelos (Whisper small + Qwen2.5 3B GGUF) se
bajan acá la primera vez y quedan cacheados en %LOCALAPPDATA%\\WhisperMeet.

Reportamos progreso REAL (byte a byte) del GGUF, que es el archivo grande
(~2GB), para que la barra de la UI se mueva de verdad. El overall se reparte:
Whisper 0→0.12, LLM 0.12→1.0.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from . import config

ProgressCb = Optional[Callable[[float, str], None]]

_WHISPER_SPAN = 0.12  # peso del tramo de Whisper en el progreso global


def whisper_ready() -> bool:
    # Layout PLANO: model.bin real directo en WHISPER_DIR (lo que carga el
    # transcriptor). No miramos el caché de HF con symlinks.
    return (config.WHISPER_DIR / "model.bin").exists() and (config.WHISPER_DIR / "config.json").exists()


def llm_ready() -> bool:
    return config.LLM_PATH.exists() and config.LLM_PATH.stat().st_size > 0


def models_ready() -> bool:
    return whisper_ready() and llm_ready()


def _fmt_mb(n: int) -> str:
    return f"{n / (1024 * 1024):.0f}MB"


def _stream_download(url: str, dest: Path, on_progress) -> None:
    """Descarga `url` a `dest` por streaming, con reanudación (.part + Range).

    on_progress(downloaded:int, total:int) se llama a medida que baja.
    """
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    existing = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={existing}-"} if existing else {}

    with requests.get(url, headers=headers, stream=True, timeout=60) as r:
        r.raise_for_status()
        resuming = r.status_code == 206 and existing > 0
        total = int(r.headers.get("Content-Length", 0)) + (existing if resuming else 0)
        downloaded = existing if resuming else 0
        mode = "ab" if resuming else "wb"
        with open(part, mode) as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                downloaded += len(chunk)
                on_progress(downloaded, total)
    part.replace(dest)


def _download_whisper(progress_cb: ProgressCb) -> None:
    if whisper_ready():
        return
    if progress_cb:
        progress_cb(0.02, "Descargando modelo de transcripción (~250MB)…")
    from faster_whisper import download_model

    download_model(config.WHISPER_MODEL_SIZE, output_dir=str(config.WHISPER_DIR))
    if progress_cb:
        progress_cb(_WHISPER_SPAN, "Modelo de transcripción listo")


def _download_llm(progress_cb: ProgressCb) -> None:
    if llm_ready():
        return
    # URL directa del archivo en HuggingFace (repo público → sin auth).
    url = f"https://huggingface.co/{config.LLM_REPO}/resolve/main/{config.LLM_FILENAME}"

    def on_progress(downloaded: int, total: int) -> None:
        if not progress_cb:
            return
        ratio = min(1.0, downloaded / total) if total else 0
        frac = _WHISPER_SPAN + (1.0 - _WHISPER_SPAN) * ratio
        pct = int(ratio * 100)
        progress_cb(
            min(0.999, frac),
            f"Descargando modelo de resumen… {pct}%  ({_fmt_mb(downloaded)}/{_fmt_mb(total)})",
        )

    if progress_cb:
        progress_cb(_WHISPER_SPAN, "Descargando modelo de resumen (Qwen2.5 3B, ~2GB)…")
    _stream_download(url, config.LLM_PATH, on_progress)


def ensure_whisper(progress_cb: ProgressCb = None) -> None:
    """Garantiza solo el modelo de transcripción."""
    _download_whisper(progress_cb)
    if progress_cb:
        progress_cb(1.0, "Modelo de transcripción listo ✓")


def ensure_llm(progress_cb: ProgressCb = None) -> None:
    """Garantiza solo el modelo de resumen."""
    _download_llm(progress_cb)
    if progress_cb:
        progress_cb(1.0, "Modelo de resumen listo ✓")


def ensure_models(progress_cb: ProgressCb = None) -> None:
    """Garantiza que ambos modelos estén disponibles localmente."""
    _download_whisper(progress_cb)
    _download_llm(progress_cb)
    if progress_cb:
        progress_cb(1.0, "Modelos listos ✓")
