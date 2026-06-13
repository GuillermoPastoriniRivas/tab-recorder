# Ficha para la Chrome Web Store

> Completá estos campos en el Developer Dashboard al subir la extensión.
> El nombre final va donde dice «NOMBRE» (ver decisión de marca).

---

## Nombre
Tab Recorder  _(máx. 75 caracteres)_

## Descripción corta / resumen  _(máx. 132 caracteres)_
Graba tus reuniones (video o solo audio) mezclando tu micrófono. 100% local y privado: nada sale de tu equipo.

## Categoría sugerida
Productividad / Herramientas

## Idioma principal
Español

---

## Descripción detallada

Grabá tus videollamadas y cualquier pestaña directamente desde el navegador, de
forma simple y privada.

🎥 **Audio + Video o solo audio** de la pestaña activa.
🎤 **Mezcla tu micrófono** con el audio de la reunión en un solo archivo.
⚙️ **Opciones avanzadas**: formato MP4 (compatible con todo) o WebM; calidad
Alta / Media / Baja para controlar el peso; y copia de solo audio opcional.
🔇 **Silenciá tu micrófono** durante la grabación con un clic.
💾 **100% local**: guardá en tu equipo o directamente en una carpeta que elijas.
🗂️ **Gestor de grabaciones**: reproducí, renombrá, marcá favoritas, guardá o
eliminá tus grabaciones.
🔊 **Seguís escuchando la reunión** mientras grabás.
🛟 **Recuperación ante cierres inesperados**: no perdés lo grabado.

🔒 **Privacidad por diseño**: no hay servidores, cuentas, analítica ni
telemetría. Tus grabaciones nunca salen de tu dispositivo. No metemos un "bot"
en tu llamada: capturamos la pestaña, así que nadie ve un participante grabando.

💡 Tip: usá auriculares para evitar eco entre tu micrófono y los parlantes.

---

## Justificación de permisos (campo "Privacy practices")

**tabCapture** — Necesario para capturar el audio y el video de la pestaña que
el usuario decide grabar. Es la función principal de la extensión y solo se
activa cuando el usuario presiona "Grabar".

**offscreen** — Necesario para ejecutar el motor de grabación (MediaRecorder +
mezcla de audio) en un documento en segundo plano, de modo que la grabación
continúe aunque se cierre la ventana emergente.

**activeTab** — Necesario para identificar y capturar la pestaña activa en el
momento en que el usuario inicia la grabación. No se accede a otras pestañas.

**storage** — Necesario para recordar las preferencias del usuario (formato,
calidad, micrófono elegido).

**Uso del micrófono** — Opcional; solo si el usuario decide mezclar su voz. El
audio se procesa localmente y nunca se transmite.

**Justificación de "host permissions"** — La extensión NO solicita permisos de
host (no usa `<all_urls>` ni dominios). Solo `activeTab`, que se limita a la
pestaña activa tras la interacción del usuario.

## Declaración de propósito único
La extensión tiene un único propósito: **grabar el audio/video de la pestaña
actual junto con el micrófono del usuario, y guardarlo localmente.**

## ¿Usa código remoto?
**No.** Todo el código está incluido en el paquete; no se carga ni ejecuta
código desde servidores externos.

## ¿Recolecta datos del usuario?
**No.** Marcar todas las casillas de "no se recolectan/transmiten datos".

## URL de la política de privacidad
(pegar acá la URL pública donde hospedes PRIVACY.md — ver instrucciones)
