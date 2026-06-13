"""Entry point para el ejecutable empaquetado (PyInstaller).

Lanza el tray + servidor backend.
"""
from whispermeet.tray import run

if __name__ == "__main__":
    run()
