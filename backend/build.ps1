# Build del ejecutable con PyInstaller (modo onedir).
# Uso (desde la carpeta backend/, con tu entorno Python activado):
#   .\build.ps1
# Después compilar el instalador con:  ISCC.exe installer\setup.iss
#
# Los modelos NO se empaquetan: se descargan en el primer arranque.

$ErrorActionPreference = "Stop"

# Usa el python del PATH (activá tu venv antes). Para crear uno:
#   py -3.11 -m venv .venv ; .\.venv\Scripts\Activate.ps1
#   pip install -r requirements.txt
#   pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
python -m pip install pyinstaller

# --collect-all arrastra DLLs nativas y data de cada paquete pesado.
python -m PyInstaller `
    --noconfirm `
    --clean `
    --name WhisperMeet `
    --windowed `
    --collect-all llama_cpp `
    --collect-all ctranslate2 `
    --collect-all av `
    --collect-all faster_whisper `
    --collect-all onnxruntime `
    --collect-submodules uvicorn `
    --hidden-import pystray._win32 `
    run.py

Write-Host ""
Write-Host "Build listo en dist\WhisperMeet\WhisperMeet.exe"
Write-Host "Ahora: ISCC.exe installer\setup.iss  (requiere Inno Setup)"
