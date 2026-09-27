/** Conservative display-only raster whitelist. Unknown color/animation metadata
 * keeps the browser's original decoder path. Sources are never rewritten. */
export interface PreviewImageInfo { width: number; height: number; format: 'png' | 'jpeg' | 'webp' }
const text = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const u32 = (bytes: Uint8Array, offset: number, little = false) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, little);
const u16 = (bytes: Uint8Array, offset: number, little = false) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, little);
const read = async (blob: Blob, offset: number, length: number) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

async function pngInfo(blob: Blob): Promise<PreviewImageInfo | null> {
  let offset = 8, dimensions: PreviewImageInfo | null = null, hasPixels = false;
  // Skip compressed payload by offsets; do not copy the entire source into JS.
  for (let count = 0; count < 512 && offset + 12 <= blob.size; count++) {
    const chunk = await read(blob, offset, 32);
    const length = u32(chunk, 0), kind = text(chunk, 4, 4);
    if (offset + length + 12 > blob.size) return null;
    if (kind === 'IHDR') {
      if (dimensions || offset !== 8 || length !== 13 || chunk[16] !== 8 || ![0, 2, 3, 4, 6].includes(chunk[17])) return null;
      dimensions = { width: u32(chunk, 8), height: u32(chunk, 12), format: 'png' };
    } else if (kind === 'IDAT') hasPixels = true;
    else if (kind === 'IEND') return dimensions && hasPixels && length === 0 && offset + 12 === blob.size ? dimensions : null;
    else if (!['PLTE', 'tRNS', 'sRGB', 'pHYs', 'tIME'].includes(kind)) return null;
    // acTL/fcTL, 16-bit IHDR, ICC/gamma/HDR/eXIf and unknown chunks fall back.
    offset += length + 12;
  }
  return null;
}

function exifOrientation(bytes: Uint8Array): number | null {
  if (text(bytes, 0, 6) !== 'Exif\0\0' || bytes.length < 14) return null;
  const little = text(bytes, 6, 2) === 'II';
  if (!little && text(bytes, 6, 2) !== 'MM') return null;
  if (u16(bytes, 8, little) !== 42) return null;
  const start = 6 + u32(bytes, 10, little);
  if (start + 2 > bytes.length) return null;
  const count = u16(bytes, start, little);
  if (start + 2 + count * 12 > bytes.length) return null;
  for (let index = 0; index < count; index++) {
    const offset = start + 2 + index * 12;
    if (u16(bytes, offset, little) !== 0x112) continue;
    if (u16(bytes, offset + 2, little) !== 3 || u32(bytes, offset + 4, little) !== 1) return null;
    const value = u16(bytes, offset + 8, little);
    return value >= 1 && value <= 8 ? value : null;
  }
  return 1;
}

async function jpegInfo(blob: Blob): Promise<PreviewImageInfo | null> {
  const bytes = await read(blob, 0, 1024 * 1024);
  let offset = 2, dimensions: PreviewImageInfo | null = null, orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      if (!dimensions) return null;
      return orientation >= 5 ? { ...dimensions, width: dimensions.height, height: dimensions.width } : dimensions;
    }
    if (offset + 2 > bytes.length) return null;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const data = bytes.subarray(offset + 2, offset + length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (data.length < 6 || data[0] !== 8 || ![1, 3].includes(data[5])) return null;
      dimensions = { width: u16(data, 3), height: u16(data, 1), format: 'jpeg' };
    } else if (marker === 0xe1) {
      const value = exifOrientation(data);
      if (value === null) return null; // XMP/gain maps or unknown APP1.
      orientation = value;
    } else if (![0xc4, 0xdb, 0xdd, 0xe0, 0xfe].includes(marker)) return null;
    // APP2 ICC/MPF, APP11 JUMBF, other SOF bit depths and unknown metadata stay original.
    offset += length;
  }
  return null;
}

async function webpInfo(blob: Blob, header: Uint8Array): Promise<PreviewImageInfo | null> {
  if (u32(header, 4, true) + 8 !== blob.size) return null;
  let offset = 12, dimensions: PreviewImageInfo | null = null, hasPixels = false;
  for (let count = 0; count < 64 && offset + 8 <= blob.size; count++) {
    const chunk = await read(blob, offset, 32);
    const kind = text(chunk, 0, 4), length = u32(chunk, 4, true);
    if (offset + 8 + length > blob.size) return null;
    if (kind === 'VP8X') {
      if (length !== 10 || chunk[8] & ~0x10) return null; // Only alpha; no animation/ICC/EXIF/XMP.
      const value24 = (i: number) => chunk[i] | chunk[i + 1] << 8 | chunk[i + 2] << 16;
      dimensions = { width: value24(12) + 1, height: value24(15) + 1, format: 'webp' };
    } else if (kind === 'VP8 ') {
      if (length < 10 || chunk[11] !== 0x9d || chunk[12] !== 0x01 || chunk[13] !== 0x2a) return null;
      dimensions ??= { width: u16(chunk, 14, true) & 0x3fff, height: u16(chunk, 16, true) & 0x3fff, format: 'webp' };
      hasPixels = true;
    } else if (kind === 'VP8L') {
      if (length < 5 || chunk[8] !== 0x2f) return null;
      const bits = u32(chunk, 9, true);
      if (bits >>> 29) return null;
      dimensions ??= { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1, format: 'webp' };
      hasPixels = true;
    } else if (kind !== 'ALPH') return null;
    offset += 8 + length + (length & 1);
  }
  return offset === blob.size && hasPixels ? dimensions : null;
}

export async function inspectPreviewImage(blob: Blob): Promise<PreviewImageInfo | null> {
  try {
    const header = await read(blob, 0, 32);
    if (header.length < 12) return null;
    let result: PreviewImageInfo | null = null;
    if (text(header, 0, 8) === '\x89PNG\r\n\x1a\n') result = await pngInfo(blob);
    else if (header[0] === 0xff && header[1] === 0xd8) result = await jpegInfo(blob);
    else if (text(header, 0, 4) === 'RIFF' && text(header, 8, 4) === 'WEBP') result = await webpInfo(blob, header);
    return result && result.width > 0 && result.height > 0 ? result : null;
  } catch { return null; }
}
