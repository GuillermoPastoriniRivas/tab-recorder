# Tab Recorder

Extensión de Chrome (Manifest V3) para grabar reuniones de **Google Meet** —o cualquier
pestaña— **100% del lado del cliente**. Captura el audio + video de la pestaña, mezcla tu
**micrófono**, y guarda todo en un único archivo WebM. Sin servidores, sin cuentas: nada
sale de tu equipo.

---

## ✨ Características

- 🎥 **Audio + Video** o 🎙️ **Solo audio** de la pestaña activa.
- 🎤 Mezcla tu **micrófono** con el audio de la reunión en una sola pista.
- ⚙️ **Opciones avanzadas**: formato **MP4** (H.264/AAC, compatible y seekable) o **WebM** (VP9, más liviano); calidad **Alta/Media/Baja** (controla resolución, fps y bitrate → domina el peso); y **copia de solo audio** opcional junto al video.
- ⏱️ **Duración del WebM corregida automáticamente**: al terminar se inyecta el elemento `Duration` (que MediaRecorder no escribe), así el WebM muestra la duración total y se puede saltar/buscar como un MP4. Si algo no encaja, se conserva el archivo original (nunca se corrompe).
- 💾 Guardado **100% local**: IndexedDB + carpeta del sistema operativo (File System Access API).
- ⏺️ **Escritura incremental a disco** mientras grabás (no llena la RAM en reuniones largas).
- ⏸️ Pausar / reanudar, cronómetro, badge **REC** en el ícono.
- 🎚️ Selector de micrófono + **medidor de nivel (waveform)** en vivo.
- 🔊 **Seguís escuchando la reunión** mientras grabás (ver gotcha #1).
- 🛟 **Recuperación ante crash**: si Chrome se cierra, recuperás lo grabado.
- 🗂️ **Gestor de grabaciones**: reproducir, guardar, descargar y eliminar.

---

## 🚀 Instalación (modo desarrollador)

1. Abrí Chrome y andá a `chrome://extensions`.
2. Activá **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** y seleccioná la carpeta del proyecto (`recorder/`).
4. Fijá la extensión en la barra (ícono del pin) para tenerla a mano.

> Requiere Chrome 116+ (por la API `offscreen` y File System Access).

## ▶️ Uso

1. Entrá a tu reunión de **Google Meet**.
2. (Opcional) Abrí el **gestor** (ícono de carpeta en el popup) y **elegí una carpeta**
   de guardado para que la grabación se escriba en vivo a disco.
3. Abrí el popup, elegí **Audio+Video** o **Solo audio**, tu **micrófono**, y tocá **Grabar**.
4. Al terminar, **Detener**. Si configuraste carpeta, ya está en disco; si no, guardala
   desde el gestor con **Guardar / Ver**.

💡 **Usá auriculares** para evitar eco entre tu mic y los parlantes.

---

## 🧩 Gotchas resueltos (por qué el código es como es)

| # | Problema | Solución en el código |
|---|----------|----------------------|
| 1 | `tabCapture` **silencia la pestaña** para vos mientras grabás. | En `offscreen.js` reconectamos el audio de la pestaña a `audioCtx.destination` (parlantes), además de a la grabación. Seguís escuchando la reunión. |
| 2 | El **popup se cierra** al perder foco → cortaría la grabación. | La captura vive en un **documento offscreen**, no en el popup. El popup solo controla. El offscreen sobrevive aunque cierres el popup o Chrome suspenda el service worker. |
| 3 | **Eco** si usás parlantes (el mic recaptura la reunión). | El micrófono se abre con `echoCancellation`, `noiseSuppression` y `autoGainControl`. El mic **no** se enruta a los parlantes (no te escuchás a vos mismo). |
| 4 | Reuniones largas **llenan la RAM**. | `MediaRecorder` con `timeslice` → emite chunks cada 3s que se escriben de inmediato a IndexedDB y/o disco. Nunca se acumula todo en memoria. |
| 5 | Los **diálogos de archivo cierran el popup** (bug conocido de MV3). | La selección de carpeta y el guardado manual viven en la página **gestor** (una pestaña), donde los diálogos funcionan sin problemas. |
| 6 | Un **crash** dejaría la grabación perdida. | Todo pasa por `IndexedDBSink`: aunque se corte, los chunks quedan en IndexedDB y el gestor los recupera. |
| 7 | El permiso de la **carpeta** (File System Access) se reinicia al recargar la extensión o reiniciar Chrome. | El *handle* persiste en IndexedDB, pero el permiso no. El popup detecta el permiso caducado (muestra "sin permiso") y el gestor lo **reactiva con un clic** (`requestPermission` sobre el handle guardado, sin re-elegir la carpeta). Si no se reactiva, la grabación cae a IndexedDB y se puede guardar manualmente. |

---

## 🏗️ Arquitectura

```
┌─────────────┐  getMediaStreamId()   ┌──────────────────────┐
│   popup     │ ───────────────────►  │  background (SW)     │
│ (controles) │                       │  ciclo offscreen,    │
└─────────────┘                       │  badge, estado       │
       │ abre                         └──────────┬───────────┘
       ▼                                         │ OFFSCREEN_START
┌─────────────┐                                  ▼
│  manager    │                    ┌──────────────────────────────┐
│ (carpeta +  │                    │      offscreen document       │
│  biblioteca)│                    │  • getUserMedia(tab) + (mic)  │
└─────────────┘                    │  • mezcla Web Audio           │
                                   │  • MediaRecorder → chunks     │
                                   └───────────────┬───────────────┘
                                                   ▼
                                          SinkManager (capa extensible)
                                          ├── IndexedDBSink  (siempre)
                                          ├── FileSystemSink (carpeta, opcional)
                                          └── RemoteSink     (v2, servidor)
```

### Archivos

| Archivo | Rol |
|---------|-----|
| `manifest.json` | Permisos (`tabCapture`, `offscreen`, `activeTab`, `storage`) y entrypoints. |
| `src/background.js` | Service worker: ciclo de vida del offscreen, badge REC, estado en `storage.session`. |
| `src/offscreen.js` | **Motor**: captura, mezcla de audio, `MediaRecorder`, escribe a los sinks. |
| `src/popup.*` | UI de control: modo, micrófono + waveform, grabar/pausar/detener. |
| `src/manager.*` | Carpeta de guardado + biblioteca (reproducir/guardar/descargar/eliminar/recuperar). |
| `src/lib/sinks.js` | **Capa extensible** de destinos de chunks (ver abajo). |
| `src/lib/db.js` | Wrapper de IndexedDB (chunks, recordings, settings). |
| `src/lib/{constants,messages,util}.js` | Config, protocolo de mensajes y helpers. |

---

## 🔌 Extensibilidad: enviar chunks a un servidor (v2)

El diseño separa **grabar** de **guardar** mediante la *capa de sinks*. El motor
(`offscreen.js`) solo llama `sink.writeChunk(blob)` por cada trozo; no sabe a dónde van.

Para **v2** (subir al servidor en vez de —o además de— guardar local), **no hay que tocar
el motor ni la UI**. Alcanza con:

1. Implementar los `TODO v2` de `RemoteSink` en [`src/lib/sinks.js`](src/lib/sinks.js)
   (POST de apertura, PUT por chunk con reintentos/backoff, POST de cierre).
2. Registrar el sink en [`src/offscreen.js`](src/offscreen.js), donde ya está marcado el punto exacto:

```js
const sinks = [new IndexedDBSink(this.recordingId)];
// ...
// ── v2 (servidor): única línea que habría que agregar ──
sinks.push(new RemoteSink({ endpoint: 'https://tu-api/...', recordingId: this.recordingId }));
```

`IndexedDBSink` puede seguir activo en paralelo como buffer offline: si la red falla, los
chunks quedan en IndexedDB y se pueden re-subir después. El `SinkManager` ya tolera que un
sink falle sin cortar la grabación.

---

## 🔒 Privacidad

Sin telemetría, sin red, sin permisos de host. La extensión solo accede a la **pestaña
activa** cuando vos tocás Grabar (`activeTab`). Todo el contenido queda en tu equipo.
