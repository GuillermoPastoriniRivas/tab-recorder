"""Resumen de la transcripción con un LLM local (Qwen2.5 3B vía llama.cpp).

Para reuniones largas usamos map-reduce: partimos la transcripción en
bloques, resumimos cada bloque (map) y después combinamos los resúmenes
parciales en uno final estructurado (reduce). Así no reventamos el
contexto del modelo aunque la reunión dure una hora.
"""
from __future__ import annotations

from typing import Callable, Optional

from . import config

_llm = None

# Caracteres por bloque de "map". ~4 chars/token → ~1500 tokens de entrada,
# dejando aire para prompt + salida dentro de los 8192 de contexto.
_CHUNK_CHARS = 6000
_CHUNK_OVERLAP = 300

ProgressCb = Optional[Callable[[float, str], None]]


def _get_llm():
    global _llm
    if _llm is None:
        from llama_cpp import Llama

        _llm = Llama(
            model_path=str(config.LLM_PATH),
            n_ctx=config.LLM_CTX,
            n_threads=config.LLM_THREADS,
            verbose=False,
        )
    return _llm


def _chat(system: str, user: str, max_tokens: int = 1024, temperature: float = 0.3) -> str:
    llm = _get_llm()
    out = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return out["choices"][0]["message"]["content"].strip()


def _chunk(text: str) -> list[str]:
    if len(text) <= _CHUNK_CHARS:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + _CHUNK_CHARS
        chunks.append(text[start:end])
        start = end - _CHUNK_OVERLAP
    return chunks


_MAP_SYSTEM = (
    "Sos un asistente que resume reuniones. Resumís de forma fiel y concisa, "
    "sin inventar nada. Respondés en el mismo idioma predominante del texto."
)

_MAP_USER = (
    "A continuación hay un fragmento de la transcripción de una reunión. "
    "Resumí los puntos principales de ESTE fragmento en viñetas breves "
    "(temas tratados, datos concretos, acuerdos y tareas si aparecen).\n\n"
    "FRAGMENTO:\n{chunk}"
)

_REDUCE_SYSTEM = _MAP_SYSTEM

_REDUCE_USER = (
    "Tenés varios resúmenes parciales de una misma reunión, en orden. "
    "Combinálos en un único resumen final, sin repetir y sin inventar. "
    "Devolvé exactamente esta estructura en Markdown:\n\n"
    "## Resumen\n(2-4 frases con lo esencial)\n\n"
    "## Temas clave\n- …\n\n"
    "## Decisiones\n- … (si no hay, poné 'Ninguna registrada')\n\n"
    "## Action items\n- [responsable si se menciona] tarea (si no hay, poné 'Ninguno registrado')\n\n"
    "RESÚMENES PARCIALES:\n{partials}"
)


def summarize(transcript_text: str, progress_cb: ProgressCb = None) -> str:
    """Devuelve un resumen en Markdown a partir del texto de la transcripción."""
    text = (transcript_text or "").strip()
    if not text:
        return "## Resumen\nLa transcripción quedó vacía (¿audio sin voz?)."

    chunks = _chunk(text)

    # --- MAP ---
    partials: list[str] = []
    for i, ch in enumerate(chunks):
        if progress_cb:
            progress_cb(i / (len(chunks) + 1), f"Resumiendo bloque {i + 1}/{len(chunks)}…")
        partials.append(_chat(_MAP_SYSTEM, _MAP_USER.format(chunk=ch), max_tokens=512))

    # Atajo: si hubo un solo bloque, igual pasamos por reduce para estructurar.
    if progress_cb:
        progress_cb(len(chunks) / (len(chunks) + 1), "Combinando resumen final…")

    joined = "\n\n---\n\n".join(f"[Parte {i + 1}]\n{p}" for i, p in enumerate(partials))
    final = _chat(_REDUCE_SYSTEM, _REDUCE_USER.format(partials=joined), max_tokens=1024)

    if progress_cb:
        progress_cb(1.0, "Resumen completo")
    return final
