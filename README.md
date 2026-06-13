# Local Whisper — graba, transcribe y resume tus reuniones, 100% local

Dos piezas que trabajan juntas para grabar reuniones (Meet, etc.) y obtener
**transcripción + resumen** sin que nada salga de tu equipo:

```
┌──────────── Extensión de Chrome ────────────┐      ┌──────── Backend local ────────┐
│  graba el tab (audio+video) → MP4/WebM       │ HTTP │  faster-whisper  → transcripción │
│  biblioteca de grabaciones                   │ ───▶ │  Qwen2.5 3B (llama.cpp) → resumen │
│  botón "Transcribir + Resumir"               │ ◀─── │  servicio headless en la bandeja  │
└──────────────────────────────────────────────┘ SSE  └───────────────────────────────────┘
                                              127.0.0.1
```

Sin nube, sin cuentas, sin Ollama. La IA corre embebida en tu CPU.

## Componentes

| Carpeta | Qué es | ¿Necesita el otro? |
|---|---|---|
| [`tab-recorder/`](tab-recorder/) | Extensión de Chrome (MV3) que graba el tab y guarda local | **No** — funciona sola como grabador |
| [`backend/`](backend/) | Servicio local (WhisperMeet) que transcribe y resume | Opcional — solo para la transcripción |

La transcripción es un **add-on opt-in**: si el backend no está corriendo, la
extensión sigue grabando y gestionando archivos igual; el botón de transcribir
simplemente avisa que el servicio no está disponible.

## Estructura del repo

```
local-whisper/
├── README.md            (este archivo)
├── LICENSE              (MIT)
├── .github/workflows/   (CI: compila el backend y publica en Releases)
├── tab-recorder/        extensión de Chrome (su propio README)
└── backend/             servicio WhisperMeet (su propio README)
    ├── run.py · cli.py · build.ps1 · requirements.txt
    ├── installer/setup.iss
    └── whispermeet/     (paquete Python)
```

## Cómo usarlo

**1. Extensión (grabar):**
`chrome://extensions` → modo desarrollador → "Cargar descomprimida" → carpeta
`tab-recorder/`. Ver [tab-recorder/README.md](tab-recorder/README.md).

**2. Backend (transcribir/resumir, opcional):**
Descargá el instalador desde **[Releases](../../releases)** y ejecutalo, o
corré desde la fuente (ver [backend/README.md](backend/README.md)). Una vez
prendido (icono en la bandeja), la extensión lo detecta solo.

> Primer arranque del backend: descarga los modelos (~2.3 GB) desde
> HuggingFace. Después funciona 100% offline.

## Distribución

El **código** vive en git; los **binarios** (instalador/zip, cientos de MB) se
publican en **GitHub Releases**. El workflow `.github/workflows/build.yml`
compila el backend en Windows y adjunta los artefactos en cada tag `vX.Y.Z`
(o a mano desde la pestaña *Actions*).

## Licencias

Proyecto bajo **MIT** (ver [LICENSE](LICENSE)). Los modelos no se redistribuyen:
se descargan en runtime — Whisper (MIT) y Qwen2.5-3B (Apache-2.0).
