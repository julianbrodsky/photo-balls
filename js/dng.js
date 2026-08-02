// Getting a picture out of a .dng file.
//
// A DNG is a TIFF wrapper around unprocessed sensor data, and no browser will
// decode sensor data: hand one to createImageBitmap and it simply fails. What
// the format also requires is an embedded preview, a finished JPEG of the shot
// as the camera would have rendered it. On an iPhone that preview is the full
// resolution ProRAW render. Finding it is the whole of raw support here, and
// it costs one small TIFF directory parser.
//
// Nothing in this file decodes an image. It walks the file's directory tree,
// picks the largest embedded JPEG, and hands those bytes back as a Blob for
// the ordinary decode path to open.
//
// Only the bytes actually needed are ever read. A directory is a few hundred
// bytes and the preview is a few megabytes, so a 70 MB raw file never has to
// sit in memory whole just to get a ball out of it.

const LITTLE_ENDIAN = 0x4949;   // 'II'
const BIG_ENDIAN = 0x4d4d;      // 'MM'
const TIFF_MAGIC = 42;          // 43 would be BigTIFF, which is a different parse

const TAG = {
  COMPRESSION: 259,
  STRIP_OFFSETS: 273,
  STRIP_BYTE_COUNTS: 279,
  SUB_IFDS: 330,
  PREVIEW_OFFSET: 513,
  PREVIEW_LENGTH: 514,
};

// 6 is the original TIFF JPEG encoding, 7 the one everything has used since.
const JPEG_COMPRESSION = new Set([6, 7]);

// Bytes per value, by TIFF field type. The gaps are the signed and floating
// types, which none of the tags looked up here ever use.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4 };

// A camera writes a handful of directories. These caps mean a corrupt or
// hostile file cannot spin the parser instead of failing.
const MAX_DIRECTORIES = 32;
const MAX_ENTRIES = 512;
const MAX_VALUES = 4096;
const MIN_JPEG_BYTES = 512;

// Resolves to a Blob of JPEG bytes, or null if the file holds nothing readable.
// Never throws for a merely malformed file: a null answer lets the caller fall
// back to letting the browser try the original.
export async function extractPreview(file) {
  const read = sliceReader(file);

  let header;
  try {
    header = await read(0, 8);
  } catch {
    return null;
  }

  const order = header.getUint16(0, false);
  if (order !== LITTLE_ENDIAN && order !== BIG_ENDIAN) return null;
  const little = order === LITTLE_ENDIAN;
  if (header.getUint16(2, little) !== TIFF_MAGIC) return null;

  // Breadth first across the directory tree: the chain of top level
  // directories, plus the SubIFDs each one points at. On most cameras the full
  // size preview is a SubIFD hanging off the first directory, and the raw
  // sensor data is its sibling.
  const candidates = [];
  const visited = new Set();
  const queue = [header.getUint32(4, little)];

  while (queue.length && visited.size < MAX_DIRECTORIES) {
    const offset = queue.shift();
    if (!offset || visited.has(offset)) continue;
    visited.add(offset);

    let directory;
    try {
      directory = await readDirectory(read, offset, little);
    } catch {
      continue;   // one unreadable directory should not lose the others
    }

    if (directory.next) queue.push(directory.next);
    for (const sub of await numbers(read, directory.entries.get(TAG.SUB_IFDS), little)) {
      queue.push(sub);
    }
    candidates.push(...await jpegsIn(read, directory.entries, little));
  }

  // Largest first. A raw file usually carries both a postage stamp thumbnail
  // and a full size preview, and only one of those makes a decent photo ball.
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const bytes = await jpegAt(file, candidate);
    if (bytes) return new Blob([bytes], { type: 'image/jpeg' });
  }
  return null;
}

// ── Reading ──────────────────────────────────────────────────────────────

// Every read is bounds checked against the real file length, so a pointer into
// nowhere throws here rather than being followed.
function sliceReader(file) {
  return async function read(offset, length) {
    if (!Number.isInteger(offset) || offset < 0 || length <= 0 || offset + length > file.size) {
      throw new RangeError('points outside the file');
    }
    return new DataView(await file.slice(offset, offset + length).arrayBuffer());
  };
}

async function readDirectory(read, offset, little) {
  const count = (await read(offset, 2)).getUint16(0, little);
  if (!count || count > MAX_ENTRIES) throw new RangeError('implausible directory');

  // The entries and the pointer to the next directory, in one read.
  const body = await read(offset + 2, count * 12 + 4);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const at = i * 12;
    entries.set(body.getUint16(at, little), {
      type: body.getUint16(at + 2, little),
      count: body.getUint32(at + 4, little),
      // The last four bytes of an entry are either the value itself or, when
      // the value needs more room than that, where the value really lives.
      body,
      valueAt: at + 8,
      pointer: body.getUint32(at + 8, little),
    });
  }
  return { entries, next: body.getUint32(count * 12, little) };
}

async function numbers(read, entry, little) {
  if (!entry) return [];
  const size = TYPE_SIZE[entry.type];
  if (!size || !entry.count || entry.count > MAX_VALUES) return [];

  const at = (data, byte) => (size === 1 ? data.getUint8(byte)
    : size === 2 ? data.getUint16(byte, little)
      : data.getUint32(byte, little));

  const total = size * entry.count;
  if (total <= 4) {
    return Array.from({ length: entry.count }, (_, i) => at(entry.body, entry.valueAt + i * size));
  }
  try {
    const data = await read(entry.pointer, total);
    return Array.from({ length: entry.count }, (_, i) => at(data, i * size));
  } catch {
    return [];
  }
}

// ── Finding the JPEGs ────────────────────────────────────────────────────

async function jpegsIn(read, entries, little) {
  const found = [];

  // The plain thumbnail: an offset and a length, and nothing to work out.
  const [offset] = await numbers(read, entries.get(TAG.PREVIEW_OFFSET), little);
  const [length] = await numbers(read, entries.get(TAG.PREVIEW_LENGTH), little);
  if (offset && length) found.push({ offset, length });

  // The real preview: a directory whose compression says JPEG, with its bytes
  // stored in strips like any other TIFF image. Only single strip previews are
  // taken. Splitting a JPEG across strips is legal and essentially unheard of,
  // and stitching one back together wrongly would produce a convincing mess
  // rather than an honest failure.
  const [compression] = await numbers(read, entries.get(TAG.COMPRESSION), little);
  if (JPEG_COMPRESSION.has(compression)) {
    const offsets = await numbers(read, entries.get(TAG.STRIP_OFFSETS), little);
    const counts = await numbers(read, entries.get(TAG.STRIP_BYTE_COUNTS), little);
    if (offsets.length === 1 && counts.length === 1 && offsets[0] && counts[0]) {
      found.push({ offset: offsets[0], length: counts[0] });
    }
  }

  return found;
}

async function jpegAt(file, { offset, length }) {
  if (length < MIN_JPEG_BYTES || offset + length > file.size) return null;
  const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  // Every JPEG opens with FF D8. Checking for it throws out an entry that
  // points at sensor data, or at nothing, before it reaches the decoder.
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}
