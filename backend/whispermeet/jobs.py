"""Cola de jobs y orquestación del pipeline.

Cada job corre en un hilo (whisper y llama.cpp son bloqueantes) y publica
eventos de progreso en una cola que el endpoint SSE va drenando hacia la
extensión.
"""
from __future__ import annotations

import queue
import threading
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from . import config, models, summarize, transcribe

_SENTINEL = object()  # marca el fin del stream de eventos de un job


@dataclass
class Job:
    id: str
    source_name: str
    media_path: str
    status: str = "queued"  # queued | running | done | error
    stage: str = ""
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    events: "queue.Queue" = field(default_factory=queue.Queue)


_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def get(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)


def _emit(job: Job, **payload) -> None:
    job.events.put(payload)


def _make_progress_cb(job: Job, stage: str):
    def cb(fraction: float, message: str) -> None:
        job.stage = stage
        _emit(job, type="progress", stage=stage, fraction=round(fraction, 3), message=message)

    return cb


def _run(job: Job) -> None:
    try:
        job.status = "running"

        # 1) Modelos (solo descarga si faltan)
        if not models.models_ready():
            models.ensure_models(_make_progress_cb(job, "download"))

        # 2) Transcripción
        _emit(job, type="progress", stage="transcribe", fraction=0.0, message="Iniciando transcripción…")
        tr = transcribe.transcribe(job.media_path, _make_progress_cb(job, "transcribe"))

        # 3) Resumen
        _emit(job, type="progress", stage="summarize", fraction=0.0, message="Iniciando resumen…")
        summary_md = summarize.summarize(tr.text, _make_progress_cb(job, "summarize"))

        # 4) Guardar .md
        md_path = _write_markdown(job.source_name, tr, summary_md)

        job.result = {
            "language": tr.language,
            "duration": tr.duration,
            "has_speech": bool(tr.text.strip()),
            "transcript": tr.text,
            "summary": summary_md,
            "output_path": str(md_path),
        }
        job.status = "done"
        _emit(job, type="done", result=job.result)
    except Exception as exc:  # noqa: BLE001 — reportamos cualquier fallo al cliente
        job.status = "error"
        job.error = str(exc)
        _emit(job, type="error", message=str(exc), detail=traceback.format_exc())
    finally:
        job.events.put(_SENTINEL)


def _write_markdown(source_name: str, tr: "transcribe.TranscriptResult", summary_md: str) -> Path:
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    stem = Path(source_name).stem or "reunion"
    out = config.OUTPUTS_DIR / f"{stem}_{stamp}.md"

    mins = int(tr.duration // 60)
    secs = int(tr.duration % 60)
    body = (
        f"# {stem}\n\n"
        f"*Idioma: {tr.language} · Duración: {mins}m {secs}s · Generado: {stamp}*\n\n"
        f"{summary_md}\n\n"
        f"---\n\n"
        f"## Transcripción completa\n\n{tr.text}\n"
    )
    out.write_text(body, encoding="utf-8")
    return out


def create(source_name: str, media_path: str) -> Job:
    job = Job(id=uuid.uuid4().hex, source_name=source_name, media_path=media_path)
    with _lock:
        _jobs[job.id] = job
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return job


def stream(job: Job):
    """Generador bloqueante de eventos de un job (se consume desde SSE)."""
    while True:
        item = job.events.get()
        if item is _SENTINEL:
            break
        yield item
