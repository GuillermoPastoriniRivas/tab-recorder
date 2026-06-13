"""Cola de jobs y orquestación del pipeline.

Hay dos tipos de job, separados:
  - "transcribe": sube un video → transcripción (Whisper).
  - "summarize":  recibe el texto de una transcripción → resumen (LLM).

Cada job corre en un hilo (whisper y llama.cpp son bloqueantes) y publica
eventos de progreso en una cola que el endpoint SSE drena hacia la extensión.
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
    kind: str  # "transcribe" | "summarize"
    source_name: str
    media_path: Optional[str] = None  # para "transcribe"
    text: Optional[str] = None        # para "summarize"
    status: str = "queued"            # queued | running | done | error
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
        if job.kind == "transcribe":
            _run_transcribe(job)
        elif job.kind == "summarize":
            _run_summarize(job)
        else:
            raise ValueError(f"Tipo de job desconocido: {job.kind}")
        job.status = "done"
        _emit(job, type="done", result=job.result)
    except Exception as exc:  # noqa: BLE001 — reportamos cualquier fallo al cliente
        job.status = "error"
        job.error = str(exc)
        _emit(job, type="error", message=str(exc), detail=traceback.format_exc())
    finally:
        job.events.put(_SENTINEL)


def _run_transcribe(job: Job) -> None:
    if not models.whisper_ready():
        models.ensure_whisper(_make_progress_cb(job, "download"))

    _emit(job, type="progress", stage="transcribe", fraction=0.0, message="Iniciando transcripción…")
    tr = transcribe.transcribe(job.media_path, _make_progress_cb(job, "transcribe"))

    out = _write_text(job.source_name, "transcripcion", _transcript_md(job.source_name, tr))
    job.result = {
        "language": tr.language,
        "duration": tr.duration,
        "has_speech": bool(tr.text.strip()),
        "transcript": tr.text,
        "output_path": str(out),
    }


def _run_summarize(job: Job) -> None:
    if not models.llm_ready():
        models.ensure_llm(_make_progress_cb(job, "download"))

    _emit(job, type="progress", stage="summarize", fraction=0.0, message="Iniciando resumen…")
    summary_md = summarize.summarize(job.text or "", _make_progress_cb(job, "summarize"))

    out = _write_text(job.source_name, "resumen", _summary_md(job.source_name, summary_md))
    job.result = {"summary": summary_md, "output_path": str(out)}


# ---------------------------------------------------------------------------
# Archivos .md en la carpeta de salida (uno por transcripción, otro por resumen)
# ---------------------------------------------------------------------------
def _write_text(source_name: str, suffix: str, body: str) -> Path:
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    stem = Path(source_name).stem or "reunion"
    out = config.OUTPUTS_DIR / f"{stem}_{suffix}_{stamp}.md"
    out.write_text(body, encoding="utf-8")
    return out


def _transcript_md(source_name: str, tr: "transcribe.TranscriptResult") -> str:
    stem = Path(source_name).stem or "reunion"
    mins, secs = int(tr.duration // 60), int(tr.duration % 60)
    return (
        f"# {stem} — transcripción\n\n"
        f"*Idioma: {tr.language} · Duración: {mins}m {secs}s*\n\n"
        f"{tr.text}\n"
    )


def _summary_md(source_name: str, summary_md: str) -> str:
    stem = Path(source_name).stem or "reunion"
    return f"# {stem} — resumen\n\n{summary_md}\n"


# ---------------------------------------------------------------------------
# Creación de jobs
# ---------------------------------------------------------------------------
def _start(job: Job) -> Job:
    with _lock:
        _jobs[job.id] = job
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return job


def create_transcribe(source_name: str, media_path: str) -> Job:
    return _start(Job(id=uuid.uuid4().hex, kind="transcribe", source_name=source_name, media_path=media_path))


def create_summarize(source_name: str, text: str) -> Job:
    return _start(Job(id=uuid.uuid4().hex, kind="summarize", source_name=source_name, text=text))


def stream(job: Job):
    """Generador bloqueante de eventos de un job (se consume desde SSE)."""
    while True:
        item = job.events.get()
        if item is _SENTINEL:
            break
        yield item
