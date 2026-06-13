"""Configuración central: rutas, puerto, token, modelos.

Todo el estado persistente (modelos descargados, token, outputs) vive en
%LOCALAPPDATA%\\WhisperMeet para no ensuciar la carpeta de instalación
(Archivos de programa, que suele ser de solo lectura).
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

APP_NAME = "WhisperMeet"

# El backend "xet" de HuggingFace se cuelga seguido en descargas grandes sin
# token. Forzamos el HTTPS clásico, que es resumible y confiable. Debe quedar
# seteado ANTES de importar huggingface_hub en cualquier módulo.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# ---------------------------------------------------------------------------
# Rutas de datos del usuario
# ---------------------------------------------------------------------------
def _base_data_dir() -> Path:
    root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(root) / APP_NAME


DATA_DIR = _base_data_dir()
MODELS_DIR = DATA_DIR / "models"
WHISPER_DIR = MODELS_DIR / "whisper"
LLM_DIR = MODELS_DIR / "llm"
OUTPUTS_DIR = DATA_DIR / "outputs"
TMP_DIR = DATA_DIR / "tmp"

for _d in (DATA_DIR, MODELS_DIR, WHISPER_DIR, LLM_DIR, OUTPUTS_DIR, TMP_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Servidor local
# ---------------------------------------------------------------------------
HOST = "127.0.0.1"  # nunca exponer fuera de la máquina
PORT = int(os.environ.get("WHISPERMEET_PORT", "8765"))

# Orígenes permitidos por CORS. La extensión manda su origin
# (chrome-extension://<id>). Hasta tener el ID definitivo permitimos
# cualquier chrome-extension:// vía regex; el token es la barrera real.
ALLOW_ORIGIN_REGEX = r"^chrome-extension://[a-p]{32}$"

TOKEN_HEADER = "X-WhisperMeet-Token"
_TOKEN_FILE = DATA_DIR / "token.txt"


def get_or_create_token() -> str:
    """Token por instalación. La extensión lo lee una vez y lo manda en
    cada request, así ninguna otra web puede pegarle al backend."""
    if _TOKEN_FILE.exists():
        tok = _TOKEN_FILE.read_text(encoding="utf-8").strip()
        if tok:
            return tok
    tok = secrets.token_urlsafe(32)
    _TOKEN_FILE.write_text(tok, encoding="utf-8")
    return tok


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
# Whisper (faster-whisper / CTranslate2). "small" es el punto dulce en CPU.
WHISPER_MODEL_SIZE = os.environ.get("WHISPERMEET_WHISPER", "small")
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"

# LLM para el resumen (GGUF, vía llama.cpp). Qwen2.5 3B Instruct Q4_K_M.
LLM_REPO = os.environ.get("WHISPERMEET_LLM_REPO", "bartowski/Qwen2.5-3B-Instruct-GGUF")
LLM_FILENAME = os.environ.get("WHISPERMEET_LLM_FILE", "Qwen2.5-3B-Instruct-Q4_K_M.gguf")
LLM_PATH = LLM_DIR / LLM_FILENAME

LLM_CTX = 8192
# Hilos: por defecto todos menos uno, para no congelar la máquina.
LLM_THREADS = max(1, (os.cpu_count() or 4) - 1)
