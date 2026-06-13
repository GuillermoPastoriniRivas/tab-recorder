// ─────────────────────────────────────────────────────────────────────────
//  Corrector de duración de WebM (MediaRecorder)
//
//  MediaRecorder graba "en vivo" y NO escribe el elemento `Duration` en la
//  cabecera (no sabe cuánto va a durar). Resultado: el reproductor no muestra
//  la duración total ni deja saltar. Como nosotros SÍ medimos la duración real,
//  la inyectamos en  Segment > Info > Duration  al terminar.
//
//  Algoritmo basado en el conocido "fix-webm-duration" (inyección de Duration
//  usando la duración medida, sin recalcular desde los clusters).
//
//  SEGURIDAD: todo va dentro de try/catch y con chequeos. Ante cualquier
//  inconsistencia se devuelve el blob ORIGINAL intacto. Nunca corrompe.
// ─────────────────────────────────────────────────────────────────────────

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODESCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;

// Longitud de un VINT (ID o tamaño) según los bits altos del primer byte.
function vintLen(b) {
  let mask = 0x80;
  for (let len = 1; len <= 8; len++) { if (b & mask) return len; mask >>= 1; }
  return 0;
}

function readId(bytes, off) {
  const len = vintLen(bytes[off]);
  if (!len || off + len > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + bytes[off + i];
  return { id, len };
}

function readSize(bytes, off) {
  const first = bytes[off];
  const len = vintLen(first);
  if (!len || off + len > bytes.length) return null;
  const top = 0xff >> len;          // máscara de bits de datos del primer byte
  let value = first & top;
  let unknown = value === top;      // tamaño "desconocido" = todos los bits en 1
  for (let i = 1; i < len; i++) {
    const b = bytes[off + i];
    if (b !== 0xff) unknown = false;
    value = value * 256 + b;
  }
  return { value, len, unknown };
}

// Ancho mínimo de VINT para representar `value` (sin caer en "desconocido").
function sizeWidth(value) {
  for (let w = 1; w <= 8; w++) { if (value < Math.pow(2, 7 * w) - 1) return w; }
  return 8;
}

function encodeSize(value, width) {
  const out = new Uint8Array(width);
  let v = value;
  for (let i = width - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (width - 1);    // bit marcador de longitud
  return out;
}

// Busca el primer elemento `targetId` escaneando hijos en [start, end).
// Si encuentra `stopId` antes, aborta (null). Si un hijo tiene tamaño
// desconocido y no es el objetivo, no podemos avanzar con seguridad → null.
function findElement(bytes, start, end, targetId, stopId) {
  let off = start;
  while (off < end) {
    const id = readId(bytes, off);
    if (!id) return null;
    const sizeOffset = off + id.len;
    const size = readSize(bytes, sizeOffset);
    if (!size) return null;
    const dataStart = sizeOffset + size.len;
    if (id.id === targetId) return { idOffset: off, idLen: id.len, sizeOffset, size, dataStart };
    if (stopId && id.id === stopId) return null;
    if (size.unknown) return null;
    off = dataStart + size.value;
  }
  return null;
}

/**
 * Devuelve un nuevo Blob WebM con el elemento Duration inyectado.
 * Si no es WebM, ya tiene Duration, o algo no encaja, devuelve el blob original.
 * @param {Blob} blob
 * @param {number} durationMs  duración real medida, en ms
 * @returns {Promise<Blob>}
 */
export async function fixWebmDuration(blob, durationMs) {
  try {
    if (!blob || !durationMs || durationMs <= 0) return blob;
    if (blob.type && !/webm/i.test(blob.type)) return blob;

    const bytes = new Uint8Array(await blob.arrayBuffer());

    const seg = findElement(bytes, 0, bytes.length, ID_SEGMENT);
    if (!seg) return blob;
    const segEnd = seg.size.unknown ? bytes.length : Math.min(seg.dataStart + seg.size.value, bytes.length);

    const info = findElement(bytes, seg.dataStart, segEnd, ID_INFO, ID_CLUSTER);
    if (!info || info.size.unknown) return blob;
    const infoEnd = info.dataStart + info.size.value;

    // TimecodeScale (default 1.000.000 ns = ms)
    let timecodeScale = 1000000;
    const ts = findElement(bytes, info.dataStart, infoEnd, ID_TIMECODESCALE);
    if (ts && !ts.size.unknown && ts.size.value <= 8) {
      let v = 0;
      for (let i = 0; i < ts.size.value; i++) v = v * 256 + bytes[ts.dataStart + i];
      if (v > 0) timecodeScale = v;
    }

    // Si ya tiene Duration, no tocamos nada.
    if (findElement(bytes, info.dataStart, infoEnd, ID_DURATION)) return blob;

    // Elemento Duration: id 0x4489 + tamaño 0x88 (8) + double big-endian.
    const durValue = (durationMs * 1e6) / timecodeScale;
    const durEl = new Uint8Array(11);
    durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88;
    new DataView(durEl.buffer).setFloat64(3, durValue, false);

    // Recalcular tamaños (Info crece; Segment crece si tiene tamaño definido).
    const infoNewDataSize = info.size.value + durEl.length;
    const infoNewWidth = Math.max(info.size.len, sizeWidth(infoNewDataSize));
    const infoWidthDelta = infoNewWidth - info.size.len;

    let segSizeBytes = null; // null → dejar el campo de tamaño tal cual (desconocido)
    let segWidthDelta = 0;
    if (!seg.size.unknown) {
      const segNewDataSize = seg.size.value + durEl.length + infoWidthDelta;
      const segNewWidth = Math.max(seg.size.len, sizeWidth(segNewDataSize));
      segSizeBytes = encodeSize(segNewDataSize, segNewWidth);
      segWidthDelta = segSizeBytes.length - seg.size.len;
    }

    // Ensamblar el nuevo archivo por partes.
    const parts = [
      bytes.subarray(0, seg.sizeOffset),                                  // cabecera EBML + ID de Segment
      segSizeBytes ? segSizeBytes : bytes.subarray(seg.sizeOffset, seg.dataStart), // tamaño de Segment
      bytes.subarray(seg.dataStart, info.sizeOffset),                     // datos de Segment hasta el ID de Info
      encodeSize(infoNewDataSize, infoNewWidth),                          // nuevo tamaño de Info
      durEl,                                                              // Duration insertado
      bytes.subarray(info.dataStart),                                     // resto del archivo
    ];

    const out = new Blob(parts, { type: blob.type || 'video/webm' });

    // Chequeo de sanidad: el tamaño debe crecer exactamente lo esperado.
    const expectedDelta = durEl.length + infoWidthDelta + segWidthDelta;
    if (out.size !== blob.size + expectedDelta) return blob;

    return out;
  } catch (err) {
    console.warn('fixWebmDuration falló; se usa el archivo original', err);
    return blob;
  }
}
