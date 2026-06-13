# Build del ejecutable con PyInstaller (modo onedir).
# Uso:  .\build.ps1
# Después compilar el instalador con:  ISCC.exe installer\setup.iss
#
# Los modelos NO se empaquetan: se descargan en el primer arranque.

$ErrorActionPreference = "Stop"
$py = ".\.venv\Scripts\python.exe"

& $py -m pip install pyinstaller

# --collect-all arrastra DLLs nativas y data de cada paquete pesado.
& $py -m PyInstaller `
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
    whispermeet.py

Write-Host ""
Write-Host "Build listo en dist\WhisperMeet\WhisperMeet.exe"
Write-Host "Ahora: ISCC.exe installer\setup.iss  (requiere Inno Setup)"
