// File validation, safe decoding, and the corner-trimming that turns a
// rectangle into a ball. Photos never leave the browser: they are read
// locally, re-rasterized onto canvases, and drawn straight to the board.
import { UPLOAD, TEXTURE_SCALE, extensionOf, isRaw } from './config.js';
import { extractPreview } from './dng.js';

// Working size for a decoded photo before it is cropped down to a tier. Big
// enough that the largest ball stays sharp, small enough that ten of them do
// not strain a phone.
const MAX_WORKING_DIM = 1200;

// Returns a list of reader-facing problems; empty means the selection is good.
// The count rule is checked on its own so a wrong number of files produces one
// clear sentence instead of ten complaints about the files themselves.
export function validateSelection(files) {
  if (files.length !== UPLOAD.requiredCount) {
    return [`This takes exactly ${UPLOAD.requiredCount} photos, and you picked ${files.length}.`];
  }
  const problems = [];
  for (const file of files) {
    // Either credential will do. A .dng often arrives with no type at all, and
    // a photo saved without an extension still has one.
    const known = UPLOAD.acceptedTypes.includes(file.type)
      || UPLOAD.acceptedExtensions.includes(extensionOf(file.name));
    const cap = isRaw(file) ? UPLOAD.maxRawBytes : UPLOAD.maxFileBytes;

    if (!known) {
      problems.push(`“${file.name}” is not a type we can read (JPEG, PNG, WebP, HEIC or DNG).`);
    } else if (file.size === 0) {
      problems.push(`“${file.name}” is empty.`);
    } else if (file.size > cap) {
      problems.push(`“${file.name}” is bigger than ${Math.round(cap / 1024 / 1024)} MB.`);
    }
  }
  return problems;
}

// Resolves to [{ canvas }] in selection order, or throws with a reader-facing
// message if any file fails. onProgress(done, total) fires before each file.
//
// Files are decoded strictly one at a time. A current phone camera shoots
// around 48 MP, which is roughly 190 MB of raw pixels once decoded no matter
// how small the compressed file is, and decoding ten at once is enough for
// mobile Safari to throw the whole page away.
export async function decodePhotos(files, onProgress) {
  const photos = [];
  for (const [i, file] of files.entries()) {
    onProgress?.(i + 1, files.length);
    photos.push(await decodeOne(file));
    // Yield, so the status line repaints and the previous photo's pixels can
    // be collected before the next decode starts.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return photos;
}

// Decoding doubles as content verification: a file that claims to be a JPEG
// but is not really an image fails right here.
async function decodeOne(file) {
  const raw = isRaw(file);
  const source = raw ? await rawSource(file) : file;
  try {
    return typeof createImageBitmap === 'function'
      ? await viaBitmap(source)
      : await viaElement(source);
  } catch {
    throw new Error(raw
      ? `“${file.name}” is a raw file with no preview inside it we could read.`
      : `“${file.name}” could not be read as an image.`);
  }
}

// No browser decodes raw sensor data, so what gets decoded is the finished
// JPEG preview the camera wrote into the same file. If there is no usable one,
// the original is handed back regardless: that costs nothing and leaves the
// door open for a browser that does know the format.
async function rawSource(file) {
  try {
    return await extractPreview(file) ?? file;
  } catch {
    return file;
  }
}

// Preferred path: an ImageBitmap can be released the moment its pixels are on
// the canvas, so a full resolution decode never waits on the garbage collector.
async function viaBitmap(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return { canvas: paint(bitmap, bitmap.width, bitmap.height) };
  } finally {
    bitmap.close();
  }
}

async function viaElement(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return { canvas: paint(image, image.naturalWidth, image.naturalHeight) };
  } finally {
    URL.revokeObjectURL(url);
    image.src = '';
  }
}

// Re-drawing onto a capped canvas bounds memory, bakes in EXIF orientation,
// and strips everything but pixels before the data reaches the game.
function paint(source, width, height) {
  if (!width || !height) throw new Error('zero-sized image');
  const scale = Math.min(1, MAX_WORKING_DIM / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Cuts the corners off. The photo is centre-cropped to a square, scaled to the
// size its tier will be drawn at, then everything outside the inscribed circle
// is erased. Doing this once per photo means the game loop only ever draws a
// plain image, with no clipping path per ball per frame.
export function cropToCircle(source, radius) {
  const size = Math.min(480, Math.round(radius * 2 * TEXTURE_SCALE));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const side = Math.min(source.width, source.height);
  ctx.drawImage(
    source,
    (source.width - side) / 2, (source.height - side) / 2, side, side,
    0, 0, size, size,
  );

  // destination-in keeps only the pixels under the circle, so the corners come
  // away fully transparent rather than merely hidden behind something.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}
