"""Servidor local headless (FastAPI).

Escucha solo en 127.0.0.1. La extensión de Chrome le pega por HTTP:
sube el Blob del video, sigue el progreso por SSE y recupera el resultado.

Seguridad: CORS restringido a orígenes chrome-extension:// + un token por
instalación que la extensión debe mandar en cada request.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import config, jobs, models

app = FastAPI(title="WhisperMeet backend", version="0.1.4")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=config.ALLOW_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_TOKEN = config.get_or_create_token()


def _check(token: str | None) -> None:
    if not token or token != _TOKEN:
        raise HTTPException(status_code=401, detail="Token inválido o ausente")


async def auth_header(x_whispermeet_token: str | None = Header(default=None)) -> None:
    _check(x_whispermeet_token)


# ---------------------------------------------------------------------------
# Estado de descarga de modelos (para poder pre-descargar desde la UI)
# ---------------------------------------------------------------------------
_dl_state = {"downloading": False, "fraction": 0.0, "message": "", "error": None}
_dl_lock = threading.Lock()


def _run_download() -> None:
    def cb(fraction: float, message: str) -> None:
        _dl_state["fraction"] = round(fraction, 3)
        _dl_state["message"] = message

    try:
        models.ensure_models(cb)
    except Exception as exc:  # noqa: BLE001
        _dl_state["error"] = str(exc)
    finally:
        _dl_state["downloading"] = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": app.version,
        "models_ready": models.models_ready(),
        # Progreso de descarga de modelos (sin token, no es sensible) para que
        # la extensión muestre la barra y el estado.
        "models": {
            "downloading": _dl_state["downloading"],
            "fraction": _dl_state["fraction"],
            "message": _dl_state["message"],
            "error": _dl_state["error"],
        },
    }


@app.get("/pair")
def pair() -> dict:
    """Entrega el token a la extensión en el primer uso. CORS ya restringe la
    LECTURA de la respuesta a orígenes chrome-extension://, así que una web
    cualquiera no puede leer el token aunque dispare el request. La extensión
    lo guarda y lo manda en `X-WhisperMeet-Token` en cada llamada posterior."""
    return {"token": _TOKEN, "port": config.PORT, "version": app.version}


@app.get("/models/status", dependencies=[Depends(auth_header)])
def models_status() -> dict:
    return {
        "whisper_ready": models.whisper_ready(),
        "llm_ready": models.llm_ready(),
        "ready": models.models_ready(),
        **_dl_state,
    }


def _kick_download() -> None:
    """Arranca la descarga de modelos en segundo plano si faltan y no está ya
    corriendo. Idempotente."""
    with _dl_lock:
        if not _dl_state["downloading"] and not models.models_ready():
            _dl_state.update(downloading=True, fraction=0.0, message="Iniciando…", error=None)
            threading.Thread(target=_run_download, daemon=True).start()


@app.on_event("startup")
def _on_startup() -> None:
    # Al arrancar el servicio (típicamente justo después de instalarlo), si
    # faltan los modelos los bajamos ya en segundo plano. Así, para cuando el
    # usuario va a transcribir, la descarga de ~2.3GB suele estar lista.
    _kick_download()


@app.post("/models/download", dependencies=[Depends(auth_header)])
def models_download() -> dict:
    _kick_download()
    return {"started": _dl_state["downloading"], "ready": models.models_ready()}


@app.post("/transcribe", dependencies=[Depends(auth_header)])
async def transcribe_ep(file: UploadFile) -> dict:
    # Guardamos el upload en disco para que faster-whisper/PyAV lo lean.
    safe_name = Path(file.filename or "grabacion.mp4").name
    dest = config.TMP_DIR / safe_name
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    job = jobs.create_transcribe(source_name=safe_name, media_path=str(dest))
    return {"job_id": job.id}


@app.post("/summarize", dependencies=[Depends(auth_header)])
def summarize_ep(payload: dict = Body(...)) -> dict:
    text = (payload.get("text") or "").strip()
    name = payload.get("source_name") or "reunion"
    if not text:
        raise HTTPException(status_code=400, detail="Falta el texto de la transcripción")
    job = jobs.create_summarize(source_name=name, text=text)
    return {"job_id": job.id}


@app.get("/jobs/{job_id}/stream")
def job_stream(job_id: str, token: str | None = Query(default=None)):
    # EventSource no permite headers custom → aceptamos el token por query.
    _check(token)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")

    def gen():
        for event in jobs.stream(job):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/jobs/{job_id}/result", dependencies=[Depends(auth_header)])
def job_result(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return {
        "status": job.status,
        "stage": job.stage,
        "error": job.error,
        "result": job.result,
    }
