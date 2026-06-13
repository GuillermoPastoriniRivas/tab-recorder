# Local Whisper — graba, transcribe y resume tus reuniones (100% local)

Graba cualquier pestaña (Meet, Zoom web, YouTube…) y obtené **transcripción +
resumen** de la reunión sin que nada salga de tu equipo. La IA corre en tu
propia PC: sin nube, sin cuentas, sin enviar tus audios a ningún lado.

```
┌──────────── Extensión de Chrome ────────────┐      ┌──────── Backend local ────────┐
│  graba el tab (audio+video) → MP4/WebM       │ HTTP │  Whisper        → transcripción │
│  biblioteca de grabaciones                   │ ───▶ │  Qwen2.5 3B     → resumen        │
│  botón "Transcribir + Resumir"               │ ◀─── │  servicio en la bandeja          │
└──────────────────────────────────────────────┘      └───────────────────────────────────┘
```

Son **dos piezas**: la **extensión** (grabador, funciona sola) y el **backend**
(transcripción/resumen, opcional). Instalás la segunda solo si querés las
transcripciones.

---

## 1. Instalación

### Paso 1 — La extensión (para grabar)

Mientras no esté en la Chrome Web Store, se carga descomprimida:

1. Descargá/cloná este repo.
2. Andá a `chrome://extensions`.
3. Activá **Modo desarrollador** (arriba a la derecha).
4. **Cargar descomprimida** → elegí la carpeta `tab-recorder/`.
5. Listo: vas a ver el ícono de **Tab Recorder** en la barra.

> Con esto ya podés grabar y guardar. La transcripción necesita el Paso 2.

### Paso 2 — El backend (para transcribir y resumir) · opcional

1. Descargá el instalador: **[WhisperMeet-Setup.exe](https://github.com/GuillermoPastoriniRivas/tab-recorder/releases/latest/download/WhisperMeet-Setup.exe)**
   (o desde la página de [Releases](https://github.com/GuillermoPastoriniRivas/tab-recorder/releases)).
2. Ejecutalo. Si Windows muestra un aviso de seguridad (el instalador no está
   firmado todavía): **Más información → Ejecutar de todas formas**.
3. Al terminar, el servicio arranca solo (vas a ver un ícono en la bandeja del
   sistema, abajo a la derecha).
4. **La primera vez** descarga los modelos de IA (~2.3 GB). Puede tardar unos
   minutos; después funciona 100% offline.

> No hace falta hacer nada más: la extensión detecta el backend automáticamente.
> Solo Windows por ahora.

---

## 2. Cómo se usa

### Grabar una reunión

1. Abrí la pestaña que querés grabar (tu reunión de Meet, etc.).
2. Clic en el ícono de **Tab Recorder**.
3. Elegí las opciones (opcional):
   - **Video** o **solo audio**.
   - **Micrófono**: se mezcla con el audio de la pestaña (útil para que se te
     escuche a vos). Podés grabar sin micrófono también.
   - **Avanzado**: formato (MP4 / WebM) y calidad (Alta / Media / Baja).
4. Tocá el botón grande para **empezar a grabar**. El logo muestra un **punto
   rojo** mientras grabás.
5. Para terminar, tocá **Detener**. La grabación queda en tu biblioteca.

> 💡 **Carpeta de guardado:** si configurás una carpeta (botón de la carpeta →
> *Configurar*), las grabaciones se escriben **en vivo a disco** mientras
> grabás, sin llenar la memoria. Si no, quedan en el navegador y las guardás al
> terminar.

### La biblioteca de grabaciones

Clic en el ícono de carpeta (arriba a la derecha del popup) para abrir el
**gestor**. Ahí ves todas tus grabaciones, con filtros, búsqueda y favoritas.

Cada grabación tiene estas acciones:

| Acción | Qué hace |
|---|---|
| **📝 Transcribir + Resumir** | Genera transcripción y resumen (necesita el backend). |
| **📄 Ver resumen** | Aparece cuando ya la transcribiste: abre el resultado al instante. |
| **▶ Reproducir** | La reproduce en una ventana. |
| **Guardar como…** | La exporta eligiendo dónde guardarla. |
| **Abrir** | La abre en una pestaña nueva (reproductor completo). |
| **Eliminar** | La borra de la biblioteca *y* del archivo en disco. |

### Transcribir y resumir

1. En la biblioteca, tocá **📝 Transcribir + Resumir** en una grabación.
2. Se abre una ventana con el progreso (transcribiendo → resumiendo).
3. Al terminar ves:
   - **Resumen** estructurado: *Resumen · Temas clave · Decisiones · Action items*.
   - La **transcripción completa** (desplegable).
   - Botones para **copiar el resumen** o **descargar un `.md`**.
4. La grabación queda marcada con **TRANSCRITA**.

> ⏱️ En CPU, una reunión de ~1 h tarda unos **15–30 min** en transcribirse, más
> unos minutos de resumen. La lanzás y seguís con lo tuyo.

### Volver a leer una transcripción

Una vez generada, queda **guardada**. Tocá **📄 Ver resumen** y se abre al
instante, sin volver a procesar ni necesitar el backend. Dentro de la ventana,
**↻ Regenerar** la rehace si querés.

### El indicador del backend

Arriba a la derecha del gestor hay un chip de estado:

- 🟢 **Backend activo** — todo listo para transcribir.
- 🔴 **Backend desactivado** — clic ahí (o en "Transcribir") y te ofrece
  **descargar e instalar** el backend. Apenas lo instalás, el chip pasa a verde
  solo.

---

## 3. Privacidad

Todo es local. La extensión guarda las grabaciones en tu equipo y el backend
corre en tu propia PC (escucha solo en `127.0.0.1`). Tus audios y
transcripciones **no se suben a ningún servidor**. Los modelos de IA se
descargan una vez desde HuggingFace y después no hace falta internet.

---

## 4. Solución de problemas

| Síntoma | Solución |
|---|---|
| El chip dice "Backend desactivado" | Abrí la app **WhisperMeet** (ícono en la bandeja). Si no la instalaste, clic en el chip → Descargar. |
| Windows bloquea el instalador | **Más información → Ejecutar de todas formas** (el `.exe` no está firmado todavía). |
| "No se detectó voz en el audio" | La grabación quedó sin sonido. Revisá que la pestaña tuviera audio y/o que el micrófono estuviera activo al grabar. |
| La carpeta dice "necesita permiso" | El permiso de carpeta se reinicia al reiniciar Chrome: tocá **Reactivar permiso** en el gestor. |
| La primera transcripción tarda mucho | La primera vez el backend baja ~2.3 GB de modelos. Esperá a que el chip deje de decir "bajando modelos". |

---

## 5. Para desarrolladores

- **Extensión:** [`tab-recorder/`](tab-recorder/) — Chrome MV3, sin dependencias.
- **Backend:** [`backend/`](backend/README.md) — Python (FastAPI + faster-whisper
  + llama.cpp). Ahí está cómo correrlo desde la fuente, la API HTTP y el
  empaquetado.
- **Releases:** el instalador se genera solo. `git tag vX.Y.Z && git push origin
  vX.Y.Z` dispara el CI (`.github/workflows/build.yml`), que compila en Windows y
  publica el `.exe` en Releases.

---

## Licencia

**MIT** (ver [LICENSE](LICENSE)). Los modelos no se redistribuyen: se descargan
en runtime — Whisper (MIT) y Qwen2.5-3B (Apache-2.0).
