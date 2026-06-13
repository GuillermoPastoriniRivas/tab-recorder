# WhisperMeet — backend local

Servicio local headless que transcribe y resume grabaciones **100% local** en
Windows (CPU). La extensión de Chrome le manda el video por HTTP en `localhost`
y recibe la transcripción + resumen.

```
Extensión Chrome ──HTTP──> Backend local (tray, headless)
  graba el Blob            faster-whisper (small) → Qwen2.5 3B (llama.cpp)
```

- **Transcripción:** faster-whisper `small` int8 (autodetecta ES/EN).
- **Resumen:** Qwen2.5 3B GGUF vía `llama-cpp-python`, con map-reduce para
  reuniones largas. Sin Ollama: el LLM corre embebido.
- **Audio:** se decodifica directo del MP4 con PyAV (sin ffmpeg externo).
- **Modelos:** se descargan en el primer arranque a `%LOCALAPPDATA%\WhisperMeet`.

## Estructura

```
backend/
  run.py            entry point (lanza tray + servidor)
  cli.py            runner de prueba por línea de comandos
  build.ps1         empaqueta con PyInstaller
  requirements.txt
  installer/setup.iss   instalador (Inno Setup)
  whispermeet/      paquete Python
    config.py       rutas, puerto, token, ids de modelos
    transcribe.py   faster-whisper (lee el MP4 directo)
    summarize.py    llama.cpp + map-reduce
    models.py       descarga de modelos (1er arranque)
    jobs.py         cola de jobs + orquestación del pipeline
    server.py       FastAPI: endpoints + SSE
    tray.py         icono de bandeja + autostart Windows
```

## Desarrollo

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# (llama-cpp-python desde wheels precompilados CPU)
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

# Probar el pipeline con un video:
python cli.py "ruta\al\video.mp4"

# Levantar el backend + tray:
python -m whispermeet
```

## API HTTP (para la extensión)

Base: `http://127.0.0.1:8765`. Todas las rutas (salvo `/health` y `/pair`)
requieren el header `X-WhisperMeet-Token: <token>`. La extensión obtiene el
token una vez vía `/pair` y lo cachea.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado y si los modelos están listos |
| GET | `/pair` | Entrega el token a la extensión (1ª vez) |
| GET | `/models/status` | Readiness + progreso de descarga |
| POST | `/models/download` | Pre-descarga los modelos |
| POST | `/process` | Sube el video (multipart `file`) → `{job_id}` |
| GET | `/jobs/{id}/stream?token=…` | SSE con progreso en vivo |
| GET | `/jobs/{id}/result` | Resultado final (transcript + summary + ruta .md) |

Eventos SSE (`data: {json}`):
- `{"type":"progress","stage":"download|transcribe|summarize","fraction":0..1,"message":"…"}`
- `{"type":"done","result":{…}}`
- `{"type":"error","message":"…"}`

## Empaquetado

```powershell
cd backend
.\build.ps1                    # PyInstaller → dist\WhisperMeet\
ISCC.exe installer\setup.iss   # Inno Setup → installer\Output\
```

El instalador es liviano (~100-200MB); los modelos (~2.3GB) se bajan en el
primer arranque. Distribución por GitHub Releases (ver README raíz).
