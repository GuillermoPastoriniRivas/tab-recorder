# WhisperMeet — backend local

Transcribe y resume grabaciones de reuniones **100% local** en Windows (CPU).
Pensado para que una extensión de Chrome lo maneje: la extensión graba el
tab, manda el video al backend por HTTP en `localhost`, y recibe la
transcripción + resumen.

```
Extensión Chrome ──HTTP──> Backend local (tray, headless)
  graba el Blob            faster-whisper (small) → Qwen2.5 3B (llama.cpp)
```

- **Transcripción:** faster-whisper `small` int8 (autodetecta ES/EN).
- **Resumen:** Qwen2.5 3B GGUF vía `llama-cpp-python`, con map-reduce para
  reuniones largas. Sin Ollama: el LLM corre embebido.

## Dos componentes independientes

1. **Extensión de Chrome** (`tab-recorder/`) — graba el tab a MP4/WebM, 100%
   local. **Funciona sola, sin el backend.** La transcripción es un add-on
   opcional: si el backend no está corriendo, el botón "Transcribir + Resumir"
   avisa amablemente y el resto de la extensión sigue funcionando igual.
2. **Backend WhisperMeet** (este repo) — servicio local headless que hace la
   IA. Se instala aparte (exe) solo si querés la transcripción/resumen.

## Licencias

Proyecto bajo **MIT** (ver `LICENSE`). Los modelos NO se redistribuyen: se
descargan en runtime desde HuggingFace — Whisper (MIT) y Qwen2.5-3B
(Apache-2.0).
- **Audio:** se decodifica directo del MP4 con PyAV (sin ffmpeg externo).
- **Modelos:** se descargan en el primer arranque a `%LOCALAPPDATA%\WhisperMeet`.

## Estructura

```
backend/
  config.py       rutas, puerto, token, ids de modelos
  transcribe.py   faster-whisper (lee el MP4 directo)
  summarize.py    llama.cpp + map-reduce
  models.py       descarga de modelos (1er arranque)
  jobs.py         cola de jobs + orquestación del pipeline
  server.py       FastAPI: endpoints + SSE
  tray.py         icono de bandeja + autostart Windows
cli.py            runner de prueba por línea de comandos
build.ps1         empaqueta con PyInstaller
installer/setup.iss   instalador (Inno Setup)
```

## Desarrollo

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# (llama-cpp-python desde wheels precompilados CPU)
.\.venv\Scripts\python.exe -m pip install llama-cpp-python `
    --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

# Probar el pipeline con un video:
.\.venv\Scripts\python.exe cli.py "ruta\al\video.mp4"

# Levantar el backend + tray:
.\.venv\Scripts\python.exe -m backend
```

## API HTTP (para la extensión)

Base: `http://127.0.0.1:8765`. Todas las rutas (salvo `/health`) requieren el
header `X-WhisperMeet-Token: <token>`. El token está en
`%LOCALAPPDATA%\WhisperMeet\token.txt` (la extensión lo lee una vez).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado y si los modelos están listos |
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
.\build.ps1                 # PyInstaller → dist\WhisperMeet\
ISCC.exe installer\setup.iss   # Inno Setup → instalador final
```

El instalador es liviano (~100-200MB); los modelos (~2.3GB) se bajan en el
primer arranque.

## Distribución (open source)

El código fuente vive en git; los **binarios NO se commitean** (pesan cientos
de MB e inflan el historial). Se distribuyen por **GitHub Releases**:

- Hacé `git tag v0.1.0 && git push --tags`.
- El workflow `.github/workflows/build.yml` compila en Windows y adjunta a la
  Release el `WhisperMeet-windows.zip` y el instalador `.exe`.
- También se puede disparar a mano desde la pestaña **Actions**
  (workflow_dispatch) para bajar los artefactos sin crear una Release.

Para compilar localmente: `.\build.ps1` (deja `dist\WhisperMeet\`).
