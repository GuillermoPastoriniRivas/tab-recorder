// Página para solicitar el permiso de micrófono en una VENTANA real.
// Pedirlo desde el popup no funciona: el prompt le quita el foco al popup y lo
// cierra, abortando getUserMedia. Acá el prompt funciona y el permiso queda
// guardado para todo el origen de la extensión (popup + offscreen incluidos).

import { MSG, TARGET } from './lib/messages.js';

const icon = document.getElementById('icon');
const title = document.getElementById('title');
const text = document.getElementById('text');
const action = document.getElementById('action');
const hint = document.getElementById('hint');

async function request() {
  action.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // solo queríamos el permiso
    // Avisamos al popup (si está abierto) para que muestre el mic sin reabrir.
    chrome.runtime.sendMessage({ target: TARGET.POPUP, type: MSG.MIC_GRANTED }).catch(() => {});
    icon.className = 'icon ok';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="m4 12 5 5 11-11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    title.textContent = '¡Micrófono habilitado!';
    text.innerHTML = 'Listo. Volvé a abrir la extensión <b>Tab Recorder</b> y vas a ver el nivel de tu micrófono.';
    action.textContent = 'Cerrar';
    action.disabled = false;
    action.classList.add('ghost');
    action.onclick = () => window.close();
    hint.textContent = 'Podés cerrar esta ventana.';
  } catch (err) {
    icon.className = 'icon err';
    title.textContent = 'No se pudo habilitar';
    if (err && err.name === 'NotAllowedError') {
      text.innerHTML = 'Bloqueaste el micrófono. Habilitalo desde el candado de la barra de direcciones (Configuración del sitio → Micrófono → Permitir) y reintentá.';
    } else {
      text.textContent = 'Error: ' + (err && err.message ? err.message : err);
    }
    action.textContent = 'Reintentar';
    action.disabled = false;
    action.onclick = request;
  }
}

action.onclick = request;

// Intento automático al abrir (el usuario ya expresó la intención al hacer clic
// en "Permitir micrófono"). Si el navegador exige gesto, queda el botón.
request();
