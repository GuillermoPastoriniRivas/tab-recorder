"""Entry point para el ejecutable empaquetado (PyInstaller).

Lanza el tray + servidor backend.
"""
from backend.tray import run

if __name__ == "__main__":
    run()
