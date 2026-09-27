import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const icon = await readFile(new URL('../src-tauri/icons/icon.ico', import.meta.url));
assert.equal(icon.readUInt16LE(0), 0, 'ICO reserved header');
assert.equal(icon.readUInt16LE(2), 1, 'ICO image type');
const count = icon.readUInt16LE(4), sizes = [];
for (let index = 0; index < count; index++) {
  const entry = 6 + index * 16;
  const width = icon[entry] || 256, height = icon[entry + 1] || 256;
  const bytes = icon.readUInt32LE(entry + 8), offset = icon.readUInt32LE(entry + 12);
  assert.equal(width, height, 'Square icon frame');
  assert(offset >= 6 + count * 16 && bytes > 0 && offset + bytes <= icon.length, 'Complete frame payload');
  const png = icon.subarray(offset, offset + 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert(png || icon.readUInt32LE(offset) === 40, 'PNG or Windows bitmap frame');
  sizes.push(width);
}
assert.deepEqual(sizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);
assert(icon.equals(await readFile(new URL('../public/logo.ico', import.meta.url))), 'Desktop and web icon match');
console.log('ICO verified: ' + sizes.join(', ') + ' px');
