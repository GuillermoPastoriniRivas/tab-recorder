# Política de Privacidad — Tab Recorder

_Última actualización: 11 de junio de 2026_

Tab Recorder es una extensión de navegador para grabar reuniones y pestañas.
Está diseñada con un principio simple: **tus grabaciones son tuyas y nunca salen
de tu equipo.**

## Qué datos recolectamos

**Ninguno.** La extensión no recolecta, transmite ni comparte datos personales,
grabaciones, audio, video ni información de uso con el desarrollador ni con
terceros. No hay servidores, cuentas, analítica ni telemetría.

## Dónde se guardan tus grabaciones

Todo el procesamiento y almacenamiento ocurre **localmente en tu dispositivo**:

- **IndexedDB** (almacenamiento del navegador): se usa como buffer temporal y
  para recuperación ante cierres inesperados. Podés eliminar cualquier grabación
  desde la propia extensión.
- **Sistema de archivos** (File System Access API): solo si vos elegís una
  carpeta de guardado, la extensión escribe los archivos en esa carpeta que
  seleccionaste explícitamente. La extensión no puede acceder a ninguna otra
  ubicación de tu disco.

## Permisos que usa la extensión y por qué

- **tabCapture**: capturar el audio y/o video de la pestaña activa cuando vos
  presionás "Grabar". Es el núcleo de la función de grabación.
- **offscreen**: ejecutar el motor de grabación en segundo plano para que la
  grabación no se interrumpa al cerrar la ventana emergente.
- **activeTab**: acceder a la pestaña actual únicamente en el momento en que
  iniciás una grabación.
- **storage**: recordar tus preferencias (formato, calidad, micrófono).
- **Micrófono** (permiso del navegador): solo si elegís mezclar tu voz en la
  grabación. El audio del micrófono se mezcla localmente y nunca se transmite.

## Terceros

La extensión no envía datos a ningún tercero. No incluye código remoto, ni
trackers, ni SDKs de analítica.

## Cambios futuros

Si en el futuro se agregan funciones opcionales en la nube (por ejemplo,
transcripción o compartir), serán **estrictamente opt-in** y esta política se
actualizará para describir con detalle qué datos se envían y a dónde, antes de
que cualquier dato salga de tu equipo.

## Contacto

Ante cualquier consulta sobre privacidad, escribí a: guillepastorini5@gmail.com
