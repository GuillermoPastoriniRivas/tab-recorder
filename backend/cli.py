"""Runner de línea de comandos para probar el pipeline sin la extensión.

    python cli.py "ruta\\al\\video.mp4"
    python cli.py "video.mp4" --no-summary   # solo transcripción

Descarga los modelos la primera vez si faltan.
"""
from __future__ import annotations

import argparse
import sys
import time

from whispermeet import jobs, models, summarize, transcribe


def _bar(fraction: float, width: int = 30) -> str:
    filled = int(fraction * width)
    return "[" + "#" * filled + "-" * (width - filled) + f"] {int(fraction * 100):3d}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="WhisperMeet — prueba local del pipeline")
    parser.add_argument("media", help="Ruta al MP4/audio")
    parser.add_argument("--no-summary", action="store_true", help="Solo transcribir")
    args = parser.parse_args()

    t0 = time.time()

    if not models.models_ready():
        print(">> Faltan modelos, descargando (puede tardar la primera vez)…")
        models.ensure_models(lambda f, m: print(f"   {m}"))

    print(f">> Transcribiendo: {args.media}")

    def tcb(f, m):
        print("\r   " + _bar(f) + f"  {m}        ", end="", flush=True)

    tr = transcribe.transcribe(args.media, tcb)
    print()
    print(f">> Idioma: {tr.language} · Duración: {tr.duration:.1f}s · {len(tr.text)} chars")
    print("\n--- TRANSCRIPCIÓN ---\n")
    print(tr.text or "(vacío)")

    if not args.no_summary:
        print("\n>> Resumiendo…")

        def scb(f, m):
            print("\r   " + _bar(f) + f"  {m}        ", end="", flush=True)

        summary = summarize.summarize(tr.text, scb)
        print()
        print("\n--- RESUMEN ---\n")
        print(summary)

        md = jobs._write_markdown(args.media, tr, summary)
        print(f"\n>> Guardado en: {md}")

    print(f"\n>> Listo en {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
