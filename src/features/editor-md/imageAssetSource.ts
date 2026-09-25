import { visitNativeDocument, type NativeNode } from '../../core/nativeDocument';
import { isInlineImageSource, isTransientImageSource } from './imageAssetReferences';

export interface ImageSourceChange { from: number; to: number; insert: string }
export interface PreparedImageSources { content: string; references: Array<[string, string]>; changes: ImageSourceChange[] }
type ResolveImage = (source: string) => Promise<string>;
interface SourceRange { from: number; to: number; src: string; html?: boolean; quoted?: boolean; angled?: boolean }
const pending = (src: string) => isInlineImageSource(src) || isTransientImageSource(src);
/** Source positions, with quoted attributes/comments/raw-text elements respected. */
function htmlImageRanges(html: string, base: number): SourceRange[] {
  const ranges: SourceRange[] = [], lower = html.toLowerCase();
  let offset = 0;
  while ((offset = html.indexOf('<', offset)) >= 0) {
    if (html.startsWith('<!--', offset)) { const end = html.indexOf('-->', offset + 4); offset = end < 0 ? html.length : end + 3; continue; }
    const tag = /^<([a-z][\w:-]*)\b/i.exec(html.slice(offset));
    if (!tag) { offset++; continue; }
    const name = tag[1].toLowerCase(); let cursor = offset + tag[0].length, srcSeen = false;
    while (cursor < html.length) {
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      if (html[cursor] === '>') { cursor++; break; }
      if (html[cursor] === '/' && html[cursor + 1] === '>') { cursor += 2; break; }
      const start = cursor;
      while (cursor < html.length && !/[\s=/>]/.test(html[cursor])) cursor++;
      if (cursor === start) { cursor++; continue; }
      const attribute = html.slice(start, cursor).toLowerCase();
      const takeSource = name === 'img' && attribute === 'src' && !srcSeen;
      if (name === 'img' && attribute === 'src') srcSeen = true;
      while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      if (html[cursor] !== '=') continue;
      cursor++; while (/\s/.test(html[cursor] ?? '') && cursor < html.length) cursor++;
      const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor++] : undefined;
      const from = cursor;
      if (quote) { while (cursor < html.length && html[cursor] !== quote) cursor++; }
      else { while (cursor < html.length && !/[\s>]/.test(html[cursor])) cursor++; }
      if (takeSource) ranges.push({ from: base + from, to: base + cursor, src: html.slice(from, cursor), html: true, quoted: Boolean(quote) });
      if (quote && html[cursor] === quote) cursor++;
    }
    offset = cursor;
    if (name === 'script' || name === 'style') { const end = lower.indexOf(`</${name}`, offset); offset = end < 0 ? html.length : end; }
  }
  return ranges;
}
export function applyImageSourceChanges(source: string, changes: readonly ImageSourceChange[]): string {
  let offset = 0; const parts: string[] = [];
  for (const change of changes) { parts.push(source.slice(offset, change.from), change.insert); offset = change.to; }
  parts.push(source.slice(offset)); return parts.join('');
}

/** Runs only at the save boundary in an owned Worker. Untouched NB frames and
 * Markdown source keep their original bytes, including invalid/source-only content. */
export async function prepareImageSources(source: string, format: 'noteboard' | 'markdown', resolve: ResolveImage): Promise<PreparedImageSources> {
  const references = new Map<string, string>(), changes: ImageSourceChange[] = [];
  const image = async (src: string) => {
    if (!pending(src)) return src;
    if (!references.has(src)) references.set(src, await resolve(src));
    return references.get(src)!;
  };
  if (format === 'noteboard') {
    const frames = /^(?:@block|@child) (.+)$/gm;
    for (let match; (match = frames.exec(source));) {
      if (!/data:image\/|\.noteboard-assets/i.test(match[1])) continue;
      let node: NativeNode;
      try { node = JSON.parse(match[1]); } catch { continue; }
      const nodes: NativeNode[] = [];
      try { visitNativeDocument(node, child => { if (child.type === 'image' && typeof child.attrs?.src === 'string') nodes.push(child); }); } catch { continue; }
      let changed = false;
      for (const child of nodes) { const before = child.attrs!.src as string, after = await image(before); if (before !== after) { child.attrs!.src = after; changed = true; } }
      if (changed) changes.push({ from: match.index + 7, to: match.index + match[0].length, insert: JSON.stringify(node) + (match[1].endsWith('\r') ? '\r' : '') });
    }
  } else {
    const { markdownLanguage } = await import('@codemirror/lang-markdown');
    const tree = markdownLanguage.parser.parse(source), ranges: SourceRange[] = [], labels = new Set<string>();
    const label = (value: string) => value.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
    const url = (from: number, to: number) => { const angled = source[from] === '<' && source[to - 1] === '>'; if (angled) { from++; to--; } ranges.push({ from, to, src: source.slice(from, to), angled }); };
    tree.iterate({ enter(node) {
      if (node.name === 'Image') {
        const destination = node.node.getChild('URL');
        if (destination) url(destination.from, destination.to);
        else {
          const explicit = node.node.getChild('LinkLabel'), name = explicit ? label(source.slice(explicit.from, explicit.to)) : '';
          labels.add(name || label(source.slice(node.from + 1, explicit?.from ?? node.to)));
        }
      }
    } });
    tree.iterate({ enter(node) {
      if (node.name === 'LinkReference') {
        const name = node.node.getChild('LinkLabel'), destination = node.node.getChild('URL');
        if (name && destination && labels.has(label(source.slice(name.from, name.to)))) url(destination.from, destination.to);
      } else if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
        ranges.push(...htmlImageRanges(source.slice(node.from, node.to), node.from));
      }
    } });
    const seen = new Set<number>();
    for (const range of ranges.sort((a, b) => a.from - b.from)) {
      if (seen.has(range.from)) continue;
      seen.add(range.from);
      let src = range.src;
      if (range.html && src.includes('&')) {
        const { DOMParser } = await import('linkedom/worker');
        src = new DOMParser().parseFromString(`<img src="${src.replace(/"/g, '&quot;')}">`, 'text/html').querySelector('img')?.getAttribute('src') ?? src;
      }
      const after = await image(src);
      if (after !== src) {
        let insert = range.html ? after.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          : !range.angled && /[\s<>]/.test(after) ? `<${after}>` : after;
        if (range.html && !range.quoted) insert = `"${insert}"`;
        changes.push({ from: range.from, to: range.to, insert });
      }
    }
  }
  return { content: changes.length ? applyImageSourceChanges(source, changes) : source, references: [...references], changes };
}
