import { db } from './lib/db.js';
import { RECORDING_STATUS } from './lib/constants.js';
import { formatDuration, formatBytes, formatDate, timestampName } from './lib/util.js';
import { fixWebmDuration } from './lib/webm-duration.js';
import { transcribeRecording, checkBackend, BACKEND_DOWNLOAD_URL } from './lib/transcriber.js';

// Ensambla el blob final; en WebM inyecta la duración para que sea seekable.
async function buildBlob(rec) {
  const blob = await db.assembleBlob(rec.id, rec.mime);
  if ((rec.mime || '').includes('webm')) return fixWebmDuration(blob, rec.durationMs);
  return blob;
}

const $ = (id) => document.getElementById(id);
const el = {
  folderName: $('folderName'), pickFolder: $('pickFolder'), clearFolder: $('clearFolder'), regrant: $('regrant'),
  recoveryBanner: $('recoveryBanner'), recoveryText: $('recoveryText'),
  list: $('list'), empty: $('empty'), emptyText: $('emptyText'), count: $('count'),
  typeFilter: $('typeFilter'), favFilter: $('favFilter'), search: $('search'), sortBy: $('sortBy'),
  selectMode: $('selectMode'), bulkBar: $('bulkBar'), bulkCount: $('bulkCount'), bulkDelete: $('bulkDelete'), bulkCancel: $('bulkCancel'),
  cAll: $('cAll'), cVideo: $('cVideo'), cAudio: $('cAudio'), cFav: $('cFav'),
  player: $('player'), playerTitle: $('playerTitle'), playerBody: $('playerBody'), playerClose: $('playerClose'),
  toast: $('toast'), rowTpl: $('rowTpl'),
  backendChip: $('backendChip'), backendChipText: $('backendChipText'),
  tx: $('tx'), txTitle: $('txTitle'), txClose: $('txClose'),
  txProgress: $('txProgress'), txStage: $('txStage'), txBarFill: $('txBarFill'), txMsg: $('txMsg'),
  txError: $('txError'), txResult: $('txResult'), txSummary: $('txSummary'),
  txTranscript: $('txTranscript'), txMeta: $('txMeta'),
  txCopy: $('txCopy'), txDownload: $('txDownload'),
  install: $('install'), installClose: $('installClose'), installDownload: $('installDownload'),
  installChip: $('installChip'), installChipText: $('installChipText'),
};

const ICONS = {
  video: 'M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm13 4 5-3v10l-5-3',
  audio: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  warn: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

let highlightId = new URLSearchParams(location.search).get('id');
let toastTimer = null;

// ── estado de filtros / selección ──
let filterType = 'all';   // 'all' | 'video' | 'audio'
let filterFav = false;
let searchText = '';
let sortBy = 'date';
let selectMode = false;
const selected = new Set();

const isVideo = (r) => r.mode !== 'audio';
const sorters = {
  date: (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.createdAt - a.createdAt,
  size: (a, b) => (b.bytes || 0) - (a.bytes || 0),
  duration: (a, b) => (b.durationMs || 0) - (a.durationMs || 0),
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
};

function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

// ── carpeta ─────────────────────────────────────────────────────────────
async function renderFolder() {
  const dir = await db.getSetting('dirHandle');
  if (dir) {
    let perm = 'prompt';
    try { perm = await dir.queryPermission({ mode: 'readwrite' }); } catch {}
    const granted = perm === 'granted';
    el.folderName.textContent = granted ? `📁 ${dir.name}` : `📁 ${dir.name} · necesita permiso`;
    el.folderName.classList.remove('muted');
    el.folderName.classList.toggle('warn', !granted);
    el.clearFolder.hidden = false;
    el.regrant.hidden = granted;                 // si caducó, ofrecemos reactivar
    el.pickFolder.textContent = 'Cambiar…';
    el.pickFolder.className = 'btn ghost';
  } else {
    el.folderName.textContent = 'Ninguna · se te pedirá al guardar';
    el.folderName.classList.add('muted');
    el.folderName.classList.remove('warn');
    el.clearFolder.hidden = true;
    el.regrant.hidden = true;
    el.pickFolder.textContent = 'Elegir carpeta…';
    el.pickFolder.className = 'btn primary';
  }
}

el.regrant.onclick = async () => {
  const dir = await db.getSetting('dirHandle');
  if (!dir) return;
  try {
    if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') {
      toast('Permiso reactivado ✓');
    } else {
      toast('Permiso no concedido');
    }
  } catch {
    toast('No se pudo reactivar el permiso');
  }
  await renderFolder();
};

el.pickFolder.onclick = async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      toast('Permiso de carpeta denegado'); return;
    }
    await db.setSetting('dirHandle', handle);
    await renderFolder();
    toast('Carpeta configurada ✓');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('No se pudo elegir la carpeta');
  }
};

el.clearFolder.onclick = async () => {
  await db.deleteSetting('dirHandle');
  await renderFolder();
  toast('Carpeta quitada');
};

// ── guardado / descarga ────────────────────────────────────────────────────
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function acceptFor(name) {
  const ext = (name?.split('.').pop() || 'webm').toLowerCase();
  const map = {
    mp4: ['video/mp4', ['.mp4']],
    m4a: ['audio/mp4', ['.m4a']],
    webm: ['video/webm', ['.webm']],
  };
  const [mimeType, exts] = map[ext] || map.webm;
  return { description: ext.toUpperCase(), accept: { [mimeType]: exts } };
}

async function saveAs(rec) {
  const blob = await buildBlob(rec);
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: rec.name || timestampName('webm'),
      types: [acceptFor(rec.name)],
    });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    toast('Guardado ✓');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    // Fallback: descarga directa (a la carpeta de Descargas)
    downloadBlob(blob, rec.name || timestampName('webm'));
    toast('Descargado a tu carpeta de Descargas');
  }
}

// ── reproductor ──────────────────────────────────────────────────────────
let currentUrl = null;
async function play(rec) {
  const blob = await buildBlob(rec);
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  el.playerTitle.textContent = rec.name;
  el.playerBody.innerHTML = '';
  const media = document.createElement(rec.mode === 'audio' ? 'audio' : 'video');
  media.src = currentUrl;
  media.controls = true;
  media.autoplay = true;
  el.playerBody.appendChild(media);
  el.player.hidden = false;
}
function closePlayer() {
  el.player.hidden = true;
  el.playerBody.innerHTML = '';
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
}
el.playerClose.onclick = closePlayer;
el.player.onclick = (e) => { if (e.target === el.player) closePlayer(); };

// ── transcripción + resumen (backend local) ─────────────────────────────────
const STAGE_LABEL = {
  download: 'Descargando modelos (solo la 1ª vez)…',
  transcribe: 'Transcribiendo el audio…',
  summarize: 'Generando el resumen…',
};

// Estado del servicio local (app de bandeja). Pinta el chip del header y, si
// está abierto, el mini-chip del modal de instalación (auto-cierra al detectar).
let backendOnline = false;
function paintChip(chip, textEl, info) {
  chip.classList.remove('checking', 'on', 'off');
  if (info) {
    chip.classList.add('on');
    textEl.textContent = info.models_ready ? 'Backend activo' : 'Backend activo · bajando modelos';
  } else {
    chip.classList.add('off');
    textEl.textContent = 'Backend desactivado';
  }
}
async function refreshBackendStatus() {
  const info = await checkBackend();
  paintChip(el.backendChip, el.backendChipText, info);
  if (!el.install.hidden) paintChip(el.installChip, el.installChipText, info);

  // Transición apagado → encendido con el modal de instalación abierto:
  // lo cerramos y avisamos.
  if (info && !backendOnline && !el.install.hidden) {
    closeInstall();
    toast('Backend detectado ✓');
  }
  backendOnline = !!info;
  return info;
}

// ── onboarding: instalar el backend ─────────────────────────────────────────
el.installDownload.href = BACKEND_DOWNLOAD_URL;
function openInstall() { el.install.hidden = false; refreshBackendStatus(); }
function closeInstall() { el.install.hidden = true; }
el.installClose.onclick = closeInstall;
el.install.onclick = (e) => { if (e.target === el.install) closeInstall(); };

// Markdown → HTML mínimo y SEGURO (escapamos antes; sin innerHTML de usuario).
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderMarkdown(md) {
  const lines = escapeHtml(md || '').split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^##\s+/.test(line)) { closeList(); html += `<h3>${line.replace(/^##\s+/, '')}</h3>`; }
    else if (/^#\s+/.test(line)) { closeList(); html += `<h2>${line.replace(/^#\s+/, '')}</h2>`; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${line.replace(/^[-*]\s+/, '')}</li>`; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${line}</p>`; }
  }
  closeList();
  return html;
}

let lastResult = null;
let lastRecName = '';

function openTx(name) {
  lastResult = null;
  lastRecName = name || 'reunion';
  el.txTitle.textContent = `Transcribir + Resumir — ${lastRecName}`;
  el.txProgress.hidden = false;
  el.txResult.hidden = true;
  el.txError.hidden = true;
  el.txStage.textContent = 'Conectando con el backend…';
  el.txMsg.textContent = '';
  el.txBarFill.style.width = '0%';
  el.tx.hidden = false;
}
function closeTx() { el.tx.hidden = true; }

function updateTxProgress(ev) {
  if (ev.type !== 'progress') return;
  el.txStage.textContent = STAGE_LABEL[ev.stage] || 'Procesando…';
  el.txMsg.textContent = ev.message || '';
  const pct = Math.round((ev.fraction || 0) * 100);
  el.txBarFill.style.width = `${pct}%`;
}

function showTxError(message) {
  el.txProgress.hidden = true;
  el.txResult.hidden = true;
  el.txError.hidden = false;
  el.txError.innerHTML = `<strong>No se pudo completar.</strong><br>${escapeHtml(message)}` +
    `<p class="muted">Verificá que la app <b>WhisperMeet</b> esté corriendo en la bandeja del sistema.</p>`;
}

function renderTxResult(result) {
  lastResult = result;
  el.txProgress.hidden = true;
  el.txError.hidden = true;
  el.txResult.hidden = false;

  const mins = Math.floor((result.duration || 0) / 60);
  const secs = Math.round((result.duration || 0) % 60);
  el.txMeta.textContent = `Idioma: ${result.language} · ${mins}m ${secs}s`;

  if (!result.has_speech) {
    el.txSummary.innerHTML = '<p><b>No se detectó voz en el audio.</b> ' +
      'Puede que la grabación no haya capturado el sonido del tab/micrófono.</p>';
    el.txTranscript.textContent = result.transcript || '(vacío)';
    return;
  }
  el.txSummary.innerHTML = renderMarkdown(result.summary);
  el.txTranscript.textContent = result.transcript || '(vacío)';
}

function buildMarkdownFile(result, name) {
  const stem = (name || 'reunion').replace(/\.[^.]+$/, '');
  return `# ${stem}\n\n*Idioma: ${result.language} · Duración: ${Math.round(result.duration)}s*\n\n` +
    `${result.summary}\n\n---\n\n## Transcripción completa\n\n${result.transcript}\n`;
}

el.txCopy.onclick = async () => {
  if (!lastResult) return;
  try { await navigator.clipboard.writeText(lastResult.summary || ''); toast('Resumen copiado ✓'); }
  catch { toast('No se pudo copiar'); }
};
el.txDownload.onclick = () => {
  if (!lastResult) return;
  const md = buildMarkdownFile(lastResult, lastRecName);
  downloadBlob(new Blob([md], { type: 'text/markdown' }), `${lastRecName.replace(/\.[^.]+$/, '')}.md`);
};
el.txClose.onclick = closeTx;
el.tx.onclick = (e) => { if (e.target === el.tx) closeTx(); };

async function transcribeFlow(rec) {
  // Chequeo rápido: ¿está el backend? Si no, mostramos el onboarding de
  // instalación en vez de un error seco.
  const info = await refreshBackendStatus();
  if (!info) { openInstall(); return; }
  openTx(rec.name);
  try {
    const blob = await buildBlob(rec);
    const result = await transcribeRecording(blob, rec.name, updateTxProgress);
    renderTxResult(result);
    toast('Transcripción lista ✓');
  } catch (err) {
    showTxError(err?.message || String(err));
  }
}

// ── renombrar ──────────────────────────────────────────────────────────────
async function renameRecording(rec, nameEl) {
  if (nameEl.dataset.editing) return;
  nameEl.dataset.editing = '1';

  const dot = rec.name.lastIndexOf('.');
  const ext = dot > 0 ? rec.name.slice(dot) : '';
  const base = dot > 0 ? rec.name.slice(0, dot) : rec.name;

  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = base;
  input.spellcheck = false;
  nameEl.style.display = 'none';
  nameEl.after(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    // saneamos caracteres inválidos para nombre de archivo (Windows)
    const clean = input.value.replace(/[\\/:*?"<>|]/g, '').trim();
    input.remove();
    nameEl.style.display = '';
    delete nameEl.dataset.editing;

    const newName = clean ? clean + ext : '';
    if (save && newName && newName !== rec.name) {
      const oldName = rec.name;
      await db.updateRecording(rec.id, { name: newName });
      await renameOnDisk(rec, oldName, newName);
      rec.name = newName;
      nameEl.textContent = newName;
      toast('Nombre actualizado ✓');
    }
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
}

// Si la grabación está guardada en la carpeta, renombramos también el archivo
// en disco (best-effort; si el navegador no soporta move(), no pasa nada).
async function renameOnDisk(rec, oldName, newName) {
  if (!rec.savedToFolder) return;
  try {
    const dir = await db.getSetting('dirHandle');
    if (!dir || (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
    const fh = await dir.getFileHandle(oldName).catch(() => null);
    if (fh && typeof fh.move === 'function') await fh.move(newName);
  } catch (err) {
    console.warn('No se pudo renombrar el archivo en disco', err);
  }
}

// ── selección masiva ────────────────────────────────────────────────────────
function updateBulk() {
  el.bulkCount.textContent = `${selected.size} seleccionada${selected.size === 1 ? '' : 's'}`;
  el.bulkDelete.disabled = selected.size === 0;
}
function exitSelect() {
  selectMode = false;
  selected.clear();
  el.selectMode.classList.remove('active');
  el.selectMode.textContent = 'Seleccionar';
  el.bulkBar.hidden = true;
  render();
}

el.selectMode.onclick = () => {
  selectMode = !selectMode;
  if (!selectMode) { exitSelect(); return; }
  selected.clear();
  el.selectMode.classList.add('active');
  el.selectMode.textContent = 'Listo';
  el.bulkBar.hidden = false;
  updateBulk();
  render();
};
el.bulkCancel.onclick = exitSelect;
el.bulkDelete.onclick = async () => {
  if (!selected.size) return;
  if (!confirm(`¿Eliminar ${selected.size} grabación(es)? No se puede deshacer.`)) return;
  const ids = [...selected];
  for (const id of ids) await db.deleteRecording(id);
  toast(`${ids.length} eliminada${ids.length === 1 ? '' : 's'}`);
  exitSelect();
};

// ── filtros / orden / búsqueda ──────────────────────────────────────────────
el.typeFilter.querySelectorAll('.seg').forEach((b) => {
  b.onclick = () => {
    filterType = b.dataset.type;
    el.typeFilter.querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === b));
    render();
  };
});
el.favFilter.onclick = () => { filterFav = !filterFav; el.favFilter.classList.toggle('active', filterFav); render(); };
el.search.oninput = () => { searchText = el.search.value.trim(); render(); };
el.sortBy.onchange = () => { sortBy = el.sortBy.value; render(); };

// ── render de la lista ─────────────────────────────────────────────────────
async function render() {
  const all = await db.listRecordings();

  // contadores (sobre el total)
  el.cAll.textContent = all.length;
  el.cVideo.textContent = all.filter(isVideo).length;
  el.cAudio.textContent = all.filter((r) => r.mode === 'audio').length;
  el.cFav.textContent = all.filter((r) => r.favorite).length;

  const incomplete = all.filter((r) => r.status === RECORDING_STATUS.RECORDING || r.status === RECORDING_STATUS.ERROR);
  el.recoveryBanner.hidden = incomplete.length === 0;

  // aplicar filtros + orden
  let recs = all;
  if (filterType === 'video') recs = recs.filter(isVideo);
  else if (filterType === 'audio') recs = recs.filter((r) => r.mode === 'audio');
  if (filterFav) recs = recs.filter((r) => r.favorite);
  if (searchText) {
    const q = searchText.toLowerCase();
    recs = recs.filter((r) => (r.name || '').toLowerCase().includes(q));
  }
  recs.sort(sorters[sortBy] || sorters.date);

  el.count.textContent = String(recs.length);
  el.list.classList.toggle('selecting', selectMode);
  el.list.innerHTML = '';

  el.empty.hidden = recs.length > 0;
  if (recs.length === 0) {
    el.emptyText.innerHTML = all.length === 0
      ? 'Todavía no hay grabaciones.<br>Abrí el popup de la extensión y tocá <b>Grabar</b>.'
      : 'No hay grabaciones que coincidan con el filtro.';
  }

  for (const rec of recs) {
    const incompleteRec = rec.status !== RECORDING_STATUS.COMPLETED;
    const node = el.rowTpl.content.firstElementChild.cloneNode(true);
    if (rec.id === highlightId) node.classList.add('highlight');
    if (incompleteRec) node.classList.add('incomplete');
    if (selected.has(rec.id)) node.classList.add('selected');

    const thumb = node.querySelector('.thumb');
    const ico = node.querySelector('.thumb-ico');
    thumb.classList.add(incompleteRec ? 'warn' : (rec.mode === 'audio' ? 'audio' : 'video'));
    ico.innerHTML = `<path d="${incompleteRec ? ICONS.warn : ICONS[rec.mode] || ICONS.video}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;

    node.querySelector('.name').textContent = rec.name || rec.id;
    const sizeTxt = rec.bytes ? formatBytes(rec.bytes) : '—';
    const durTxt = rec.durationMs ? formatDuration(rec.durationMs) : '—';
    node.querySelector('.sub').textContent = `${formatDate(rec.createdAt)} · ${durTxt} · ${sizeTxt}`;

    const badges = node.querySelector('.badges');
    badges.innerHTML =
      `<span class="badge mode">${rec.mode === 'audio' ? 'AUDIO' : 'VIDEO'}</span>` +
      (rec.savedToFolder ? '<span class="badge folder">EN CARPETA</span>' : '') +
      (incompleteRec ? '<span class="badge warn">INCOMPLETA</span>' : '');

    // selección por fila (modo selección)
    const check = node.querySelector('.act-check');
    check.checked = selected.has(rec.id);
    node.onclick = (e) => {
      if (!selectMode) return;
      if (e.target !== check) check.checked = !check.checked;
      if (check.checked) selected.add(rec.id); else selected.delete(rec.id);
      node.classList.toggle('selected', check.checked);
      updateBulk();
    };

    const favBtn = node.querySelector('.act-fav');
    favBtn.classList.toggle('is-fav', !!rec.favorite);
    favBtn.title = rec.favorite ? 'Quitar de favoritas' : 'Marcar como favorita';
    favBtn.onclick = async () => {
      rec.favorite = !rec.favorite;
      await db.updateRecording(rec.id, { favorite: rec.favorite });
      render(); // re-ordena: favoritas arriba
    };

    node.querySelector('.act-rename').onclick = () => renameRecording(rec, node.querySelector('.name'));
    node.querySelector('.act-transcribe').onclick = () => transcribeFlow(rec).catch((e) => showTxError(e?.message || String(e)));
    node.querySelector('.act-play').onclick = () => play(rec).catch(() => toast('No se pudo reproducir'));
    node.querySelector('.act-save').onclick = () => saveAs(rec);
    node.querySelector('.act-dl').onclick = async () => {
      const blob = await buildBlob(rec);
      downloadBlob(blob, rec.name || timestampName('webm'));
    };
    node.querySelector('.act-del').onclick = async () => {
      if (!confirm(`¿Eliminar "${rec.name}"? Esta acción no se puede deshacer.`)) return;
      await db.deleteRecording(rec.id);
      toast('Grabación eliminada');
      render();
    };

    el.list.appendChild(node);
  }

  // recuperar grabaciones interrumpidas: marcarlas como completas si tienen chunks
  for (const rec of incomplete) {
    const n = await db.countChunks(rec.id);
    if (n > 0 && rec.status === RECORDING_STATUS.RECORDING) {
      await db.updateRecording(rec.id, { status: RECORDING_STATUS.COMPLETED });
    }
  }

  // desplazar al elemento resaltado
  if (highlightId) {
    const hl = el.list.querySelector('.highlight');
    hl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightId = null;
  }
}

// ── init ───────────────────────────────────────────────────────────────────
(async () => {
  await renderFolder();
  await render();
  await refreshBackendStatus();
  // Chip: si está activo, re-verifica; si está apagado, abre el onboarding.
  el.backendChip.onclick = () => { if (backendOnline) refreshBackendStatus(); else openInstall(); };
  // Sondeo periódico: apenas instalan el backend y arranca, el chip pasa a
  // verde solo (y se cierra el modal de instalación si estaba abierto).
  setInterval(() => { if (document.visibilityState === 'visible') refreshBackendStatus(); }, 5000);
})();

window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePlayer(); closeTx(); closeInstall(); } });
