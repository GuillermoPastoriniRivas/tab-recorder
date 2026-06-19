<div align="center">

# 🎙️ Local Whisper

### Record any browser tab → transcript + summary, 100% on your machine

[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-4285F4?logo=googlechrome&logoColor=white)](#)
[![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](#)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](#)
[![Whisper](https://img.shields.io/badge/faster--whisper-FFD21E)](#)
[![Privacy](https://img.shields.io/badge/Privacy-100%25_local-success)](#)

*Capture Meet, Zoom-web, YouTube — any tab — and get a full **transcript + meeting summary** without a single byte leaving your computer. The AI runs locally: no cloud, no accounts, no uploads.*

</div>

---

## ✨ Features

- 🔴 **Record any tab** — Google Meet, Zoom (web), YouTube, podcasts… if it plays in a tab, you can capture it.
- 📝 **Local transcription** — powered by `faster-whisper`.
- 🧠 **Local summary** — a quantized LLM (`llama-cpp-python`) turns the transcript into a clean meeting summary, no Ollama required.
- 🔒 **Truly private** — everything runs on your PC. Nothing is sent anywhere.
- 🧩 **Works standalone** — the extension runs on its own and auto-detects the optional local backend when it's available.

## 🛠️ How it works

```
Chrome tab audio ──▶ extension ──▶ local backend (FastAPI)
                                       ├─ faster-whisper  → transcript
                                       └─ llama.cpp (LLM) → summary
                                   (all on localhost — nothing leaves your machine)
```

| Component | Tech |
|-----------|------|
| **Extension** | Chrome MV3, tab audio capture |
| **Backend** | Python · FastAPI · Uvicorn · faster-whisper · llama-cpp-python · Hugging Face Hub |

## 🚀 Quick start

```bash
# Backend (downloads models on first run)
cd backend
pip install -r requirements.txt
python -m uvicorn app:app --port 8000   # headless local service

# Extension
# Load the tab-recorder/ folder as an unpacked extension in chrome://extensions
```

## 📁 Project structure

```
tab-recorder/
├── backend/        # FastAPI service: Whisper transcription + local LLM summary
└── tab-recorder/   # Chrome extension (capture UI)
```

---

<div align="center">
<sub>Built by <a href="https://github.com/GuillermoPastoriniRivas">Guillermo Pastorini</a> · see LICENSE</sub>
</div>
