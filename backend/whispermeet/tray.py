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
def _log_error(label: str, exc_text: str) -> None:
    """Registra errores en %LOCALAPPDATA%\\WhisperMeet\\backend.log para que el
    backend headless no falle nunca en silencio."""
    try:
        with open(config.DATA_DIR / "backend.log", "a", encoding="utf-8") as f:
            f.write(f"=== {label} ===\n{exc_text}\n")
    except Exception:  # noqa: BLE001
        pass


def _serve() -> None:
    import traceback

    try:
        import uvicorn

        from .server import app

        # loop/http explícitos: en el exe empaquetado, la autodetección de
        # uvicorn puede no encontrar las implementaciones e impedir el arranque.
        uvicorn.run(
            app,
            host=config.HOST,
            port=config.PORT,
            log_level="warning",
            loop="asyncio",
            http="h11",
        )
    except Exception:  # noqa: BLE001
        _log_error("Error al iniciar el servidor", traceback.format_exc())


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


def _status_text() -> str:
    """Texto de estado para el tooltip y el menú de la bandeja."""
    from . import models
    from .server import _dl_state

    if models.models_ready():
        return f"Listo · escuchando en :{config.PORT}"
    if _dl_state.get("downloading"):
        pct = int(_dl_state.get("fraction", 0) * 100)
        return f"Preparando modelos… {pct}%"
    if _dl_state.get("error"):
        return "Error al descargar modelos"
    return "Iniciando…"


def _monitor(icon) -> None:
    """Refleja el estado en el tooltip y avisa una vez cuando queda listo."""
    import time

    from . import models

    notified = False
    while True:
        try:
            icon.title = f"{config.APP_NAME} — {_status_text()}"
            if models.models_ready() and not notified:
                notified = True
                try:
                    icon.notify("Modelos listos. Ya podés transcribir tus grabaciones.", config.APP_NAME)
                except Exception:  # noqa: BLE001 — la notificación es best-effort
                    pass
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)


def _ensure_std_streams() -> None:
    """En el exe empaquetado con --windowed, sys.stdout/stderr son None. Varias
    libs (uvicorn al loguear) crashean al escribir ahí. Los redirigimos al log
    para que el servidor arranque igual y quede registro."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        log = open(config.DATA_DIR / "backend.log", "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = log
        if sys.stderr is None:
            sys.stderr = log
    except Exception:  # noqa: BLE001
        import io

        if sys.stdout is None:
            sys.stdout = io.StringIO()
        if sys.stderr is None:
            sys.stderr = io.StringIO()


def run() -> None:
    import pystray

    _ensure_std_streams()
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
        # Texto dinámico: muestra "Preparando modelos… NN%" o "Listo".
        pystray.MenuItem(lambda item: f"{config.APP_NAME} — {_status_text()}", None, enabled=False),
        pystray.MenuItem("Abrir carpeta de resúmenes", on_open_outputs),
        pystray.MenuItem("Ver estado (/health)", on_health),
        pystray.MenuItem(
            "Arrancar con Windows",
            on_toggle_autostart,
            checked=lambda item: is_autostart_enabled(),
        ),
        pystray.MenuItem("Salir", on_quit),
    )

    icon = pystray.Icon(config.APP_NAME, _make_icon_image(), f"{config.APP_NAME} — iniciando…", menu)
    threading.Thread(target=_monitor, args=(icon,), daemon=True).start()
    icon.run()


if __name__ == "__main__":
    run()
