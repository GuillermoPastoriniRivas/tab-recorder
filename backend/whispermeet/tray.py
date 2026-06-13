"""App de bandeja (tray) que hostea el backend.

Levanta el servidor uvicorn en un hilo y muestra un icono en la bandeja
del sistema con acciones básicas. Pensada para arrancar con Windows y
quedar escuchando en segundo plano.
"""
from __future__ import annotations

import sys
import threading
import webbrowser

from . import config

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_RUN_NAME = config.APP_NAME


# ---------------------------------------------------------------------------
# Servidor en un hilo
# ---------------------------------------------------------------------------
def _serve() -> None:
    import uvicorn

    from .server import app

    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")


# ---------------------------------------------------------------------------
# Autostart con Windows (HKCU\...\Run)
# ---------------------------------------------------------------------------
def _autostart_command() -> str:
    if getattr(sys, "frozen", False):  # empaquetado con PyInstaller
        return f'"{sys.executable}"'
    return f'"{sys.executable}" -m whispermeet'


def is_autostart_enabled() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _RUN_NAME)
        return True
    except OSError:
        return False


def set_autostart(enabled: bool) -> None:
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, _RUN_NAME, 0, winreg.REG_SZ, _autostart_command())
        else:
            try:
                winreg.DeleteValue(key, _RUN_NAME)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Icono
# ---------------------------------------------------------------------------
def _make_icon_image():
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (64, 64), (24, 24, 28))
    d = ImageDraw.Draw(img)
    # Un micrófono minimalista
    d.rounded_rectangle((26, 12, 38, 40), radius=6, fill=(120, 170, 255))
    d.arc((20, 28, 44, 52), start=0, end=180, fill=(120, 170, 255), width=3)
    d.line((32, 50, 32, 58), fill=(120, 170, 255), width=3)
    d.line((24, 58, 40, 58), fill=(120, 170, 255), width=3)
    return img


def run() -> None:
    import pystray

    threading.Thread(target=_serve, daemon=True).start()

    def on_open_outputs(icon, item):
        import os

        os.startfile(str(config.OUTPUTS_DIR))  # noqa: S606 — abrir carpeta del usuario

    def on_health(icon, item):
        webbrowser.open(f"http://{config.HOST}:{config.PORT}/health")

    def on_toggle_autostart(icon, item):
        set_autostart(not is_autostart_enabled())

    def on_quit(icon, item):
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(f"{config.APP_NAME} — escuchando en {config.PORT}", None, enabled=False),
        pystray.MenuItem("Abrir carpeta de resúmenes", on_open_outputs),
        pystray.MenuItem("Ver estado (/health)", on_health),
        pystray.MenuItem(
            "Arrancar con Windows",
            on_toggle_autostart,
            checked=lambda item: is_autostart_enabled(),
        ),
        pystray.MenuItem("Salir", on_quit),
    )

    icon = pystray.Icon(config.APP_NAME, _make_icon_image(), config.APP_NAME, menu)
    icon.run()


if __name__ == "__main__":
    run()
