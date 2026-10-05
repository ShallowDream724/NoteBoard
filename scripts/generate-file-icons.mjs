import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'pierre-file-icons');
const REPOSITORY = 'https://github.com/pierrecomputer/vscode-icons';
const COMMIT = '04a9028f0b227aaf820e9e73da2992af86ba0f26';
const RAW_BASE = `https://raw.githubusercontent.com/pierrecomputer/vscode-icons/${COMMIT}/`;
const VIEW_BOX = '0 0 16 16';
const SECONDARY_FILL = 'var(--file-icon-secondary, currentColor)';
const SECONDARY_COLOR_ICONS = new Set(['lang-python', 'astro', 'webpack']);
const ID = /^[A-Za-z_][\w.-]*$/;
const ICON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop']);
const ATTRIBUTES = new Set(['xmlns', 'width', 'height', 'viewBox', 'id', 'class', 'd', 'fill', 'fill-rule', 'clip-rule', 'opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'clip-path', 'mask', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity']);

function fail(message, file = 'sprite') {
  throw new Error(`${file}: ${message}`);
}

function hasControlCharacters(value, allowWhitespace = false) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && !(allowWhitespace && [9, 10, 13].includes(code))) return true;
  }
  return false;
}

function attributes(text, file) {
  const result = new Map();
  const pattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([^"']*)\2/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index !== cursor) fail('Malformed or unquoted attribute', file);
    const [, name, , value] = match;
    if (/^on/i.test(name)) fail(`Event handler ${name} is forbidden`, file);
    if (!ATTRIBUTES.has(name)) fail(`Unsupported attribute ${name}`, file);
    if (result.has(name)) fail(`Duplicate attribute ${name}`, file);
    if (/[<>&]/.test(value) || hasControlCharacters(value)) fail(`Unsafe attribute value for ${name}`, file);
    if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(value)) fail('External URL is forbidden', file);
    if (/^(?:javascript|data|https?|file):/i.test(value)) {
      if (!(name === 'xmlns' && value === 'http://www.w3.org/2000/svg')) fail('External reference is forbidden', file);
    }
    if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') fail('Unsupported namespace', file);
    if (name === 'id' && !ID.test(value)) fail('Invalid id', file);
    if ((name === 'fill' || name === 'stroke' || name === 'stop-color') && !/^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,8}|url\(#[A-Za-z_][\w.-]*\))$/.test(value)) fail(`Unsupported paint ${value}`, file);
    result.set(name, value);
    cursor = match.index + match[0].length;
  }
  if (text.slice(cursor).trim()) fail('Malformed attributes', file);
  return result;
}

/** Strictly accept inert SVG geometry and local paint references. No XML entities. */
export function validateSvg(source, file = 'SVG') {
  const svg = source.trim();
  if (svg.includes('&') || hasControlCharacters(svg, true) || /<\s*[!?]/.test(svg)) fail('XML declarations, entities and control characters are forbidden', file);
  const stack = [];
  const ids = new Set();
  const references = new Set();
  let root;
  let bodyStart;
  let bodyEnd;
  let cursor = 0;
  for (const token of svg.matchAll(/<[^>]*>|[^<]+/g)) {
    if (token.index !== cursor) fail('Malformed XML', file);
    const text = token[0];
    cursor = token.index + text.length;
    if (!text.startsWith('<')) {
      if (text.trim()) fail('Text content is unsupported', file);
      continue;
    }
    const closing = text.match(/^<\/([A-Za-z][\w:-]*)\s*>$/);
    if (closing) {
      if (stack.pop() !== closing[1]) fail('Mismatched closing tag', file);
      if (!stack.length) bodyEnd = token.index;
      continue;
    }
    const opening = text.match(/^<([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/);
    if (!opening) fail('Malformed tag', file);
    const [, name, rawAttributes, selfClosing] = opening;
    if (!ELEMENTS.has(name)) fail(`Unsupported element ${name}`, file);
    const attrs = attributes(rawAttributes, file);
    if (!stack.length) {
      if (root || name !== 'svg' || selfClosing) fail('Exactly one SVG root is required', file);
      root = attrs;
      bodyStart = cursor;
    } else if (name === 'svg' || attrs.has('xmlns') || attrs.has('viewBox')) {
      fail('Nested viewports and namespaces are unsupported', file);
    }
    if (attrs.has('id')) {
      const id = attrs.get('id');
      if (ids.has(id)) fail(`Duplicate id ${id}`, file);
      ids.add(id);
    }
    for (const value of attrs.values()) {
      const reference = value.match(/^url\(#([A-Za-z_][\w.-]*)\)$/);
      if (reference) references.add(reference[1]);
    }
    if (!selfClosing) stack.push(name);
  }
  if (cursor !== svg.length || stack.length || !root || bodyEnd === undefined) fail('Incomplete SVG document', file);
  if (root.has('id')) fail('Root SVG id is unsupported', file);
  for (const id of references) if (!ids.has(id)) fail(`Unresolved local reference ${id}`, file);
  const viewBox = root.get('viewBox');
  const values = viewBox?.trim().split(/[\s,]+/).map(Number);
  if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) fail('Invalid viewBox', file);
  return { attributes: root, body: svg.slice(bodyStart, bodyEnd).trim(), ids, viewBox, values };
}

function formatNumber(value) {
  return Number(value.toFixed(8)).toString();
}

function symbol(name, source) {
  const parsed = validateSvg(source, `${name}.svg`);
  // Each upstream definition has a private namespace inside the shared sprite.
  const ids = new Map([...parsed.ids].map((id) => [id, `${name}--${id}`]));
  let body = parsed.body.replace(/\bid=(["'])([^"']+)\1/g, (_, quote, id) => `id=${quote}${ids.get(id)}${quote}`)
    .replace(/url\(#([A-Za-z_][\w.-]*)\)/g, (_, id) => `url(#${ids.get(id)})`);
  if (SECONDARY_COLOR_ICONS.has(name)) {
    let replacements = 0;
    body = body.replace(/<path\b[^>]*>/g, (tag) => {
      if (!/\bclass=(["'])bg\1/.test(tag)) return tag;
      const rewritten = tag.replace(/\bfill=(["'])currentColor\1/, `fill="${SECONDARY_FILL}"`);
      if (rewritten !== tag) replacements += 1;
      return rewritten;
    });
    if (replacements !== 1) fail('Expected one background path with class="bg"', name);
  }
  const presentation = [...parsed.attributes].filter(([attribute]) => !['xmlns', 'width', 'height', 'viewBox'].includes(attribute))
    .map(([attribute, value]) => ` ${attribute}="${value}"`).join('');
  let sourceViewBox = '';
  if (parsed.viewBox !== VIEW_BOX) {
    const [x, y, width, height] = parsed.values;
    const scale = Math.min(16 / width, 16 / height);
    const offsetX = (16 - width * scale) / 2;
    const offsetY = (16 - height * scale) / 2;
    const transform = `translate(${formatNumber(offsetX)} ${formatNumber(offsetY)}) scale(${formatNumber(scale)}) translate(${formatNumber(-x)} ${formatNumber(-y)})`;
    body = `<g transform="${transform}">\n${body}\n</g>`;
    sourceViewBox = ` data-source-view-box="${parsed.viewBox}"`;
  }
  const indented = body.split('\n').map((line) => `    ${line.trim()}`).join('\n');
  return `  <symbol id="${name}" viewBox="${VIEW_BOX}"${sourceViewBox}${presentation}>\n${indented}\n  </symbol>`;
}

function validateSprite(svg, expectedSymbols) {
  const ids = new Set();
  for (const match of svg.matchAll(/\bid="([^"]+)"/g)) {
    if (ids.has(match[1])) fail(`Duplicate generated id ${match[1]}`);
    ids.add(match[1]);
  }
  for (const match of svg.matchAll(/url\(#([^)]+)\)/g)) if (!ids.has(match[1])) fail(`Unresolved generated id ${match[1]}`);
  if ([...svg.matchAll(/<symbol\b/g)].length !== expectedSymbols) fail('Incorrect symbol count');
  if (/<\s*(?:script|foreignObject|image|use)\b/i.test(svg) || /\s(?:on[\w:-]+|href|xlink:href|style)\s*=/i.test(svg)) fail('Unsafe generated SVG');
}

async function emit(path, content, check) {
  if (check) {
    if (await readFile(path, 'utf8') !== content) fail(`Generated file is stale: ${path}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

export async function generate({ check = false } = {}) {
  const manifest = JSON.parse(await readFile(join(VENDOR, 'manifest.json'), 'utf8'));
  if (manifest.repository !== REPOSITORY || manifest.commit !== COMMIT || manifest.license !== 'MIT') fail('Unexpected upstream provenance', 'manifest');
  const tokenIcons = Object.values(manifest.treeTokenIcons).map((entry) => entry.icon);
  const iconNames = [...new Set([...tokenIcons, ...manifest.supplementalIcons])].sort();
  if (!iconNames.length || iconNames.some((name) => !ICON.test(name))) fail('Invalid icon selection', 'manifest');
  const expected = new Set(['LICENSE.md', ...iconNames.map((name) => `svgs/${name}.svg`)]);
  const files = new Map();
  for (const entry of manifest.files) {
    if (!expected.has(entry.path) || files.has(entry.path) || entry.url !== RAW_BASE + entry.path) fail(`Unexpected or duplicate source ${entry.path}`, 'manifest');
    const bytes = await readFile(join(VENDOR, entry.path));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.bytes || hash !== entry.sha256) fail('Source SHA256 or byte size mismatch', entry.path);
    files.set(entry.path, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  if (files.size !== expected.size) fail('Missing selected source file', 'manifest');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">\n${iconNames.map((name) => symbol(name, files.get(`svgs/${name}.svg`))).join('\n')}\n</svg>\n`;
  validateSprite(svg, iconNames.length);
  const license = `Pierre VSCode Icons\nSource: ${REPOSITORY}\nCommit: ${COMMIT}\n\n${files.get('LICENSE.md')}`;
  await emit(join(ROOT, 'src', 'assets', 'file-icons.svg'), svg, check);
  await emit(join(ROOT, 'public', 'licenses', 'pierre-vscode-icons.txt'), license, check);
  const result = { symbols: iconNames.length, spriteBytes: Buffer.byteLength(svg), licenseBytes: Buffer.byteLength(license), sourceBytes: manifest.files.reduce((total, entry) => total + entry.bytes, 0), spriteSha256: createHash('sha256').update(svg).digest('hex') };
  console.log(`${check ? 'Verified' : 'Generated'} Pierre file icons: ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--check')) throw new Error('Usage: node scripts/generate-file-icons.mjs [--check]');
  await generate({ check: args.includes('--check') });
}
