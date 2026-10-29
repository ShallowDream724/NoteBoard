import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NativeNode } from '../../core/nativeDocument';

export interface DocumentStatistics { characters: number; words: number }
export const EMPTY_DOCUMENT_STATISTICS: DocumentStatistics = Object.freeze({ characters: 0, words: 0 });
export const DOCUMENT_STATISTICS_DESCRIPTION = '字符不含空白，包含标点；中日韩文字每字计一词，其它文字按连续字母或数字计词。正文包含代码、图表注释和容器标题；不含公式、图表源码、图片地址、隐藏说明及文件元数据。';

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const letterOrNumber = /[\p{L}\p{N}\p{M}]/u;
const whitespace = /\s/u;

/** Count Unicode code points, rather than UTF-16 units. No locale dictionary or full-document segmentation allocation. */
export function countDocumentText(text: string): DocumentStatistics {
  let characters = 0, words = 0, inWord = false;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 128) {
      if (code !== 32 && (code < 9 || code > 13)) characters += 1;
      if (code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122) {
        if (!inWord) words += 1; inWord = true;
      } else if (code !== 39) inWord = false;
      continue;
    }
    if (!whitespace.test(character)) characters += 1;
    if (cjk.test(character)) { words += 1; inWord = false; }
    else if (letterOrNumber.test(character)) { if (!inWord) words += 1; inWord = true; }
    else if (character !== "'" && character !== '’') inWord = false;
  }
  return { characters, words };
}

const excluded = new Set(['annotationStore', 'annotationBody', 'documentPresentation', 'nativeError', 'authoringRaw', 'mathInline', 'mathBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock']);
const textblocks = new Set(['paragraph', 'heading', 'codeBlock', 'figureCaption']);
const empty = EMPTY_DOCUMENT_STATISTICS;
function add(left: DocumentStatistics, right: DocumentStatistics): DocumentStatistics {
  return { characters: left.characters + right.characters, words: left.words + right.words };
}
function caption(attrs: Record<string, unknown>): string {
  if (Array.isArray(attrs.captionContent)) return attrs.captionContent.map(value => inlineNativeText(value as NativeNode)).join('');
  return typeof attrs.caption === 'string' ? attrs.caption : '';
}
function inlineNativeText(node: NativeNode): string {
  if (excluded.has(node.type ?? '') || node.type === 'image') return ' ';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(inlineNativeText).join('');
}

/** Native semantic nodes only: attributes such as src, raw, latex and marks never become body text. */
export function countNativeDocument(node: NativeNode): DocumentStatistics {
  if (excluded.has(node.type ?? '')) return empty;
  if (node.type === 'image') return countDocumentText(caption(node.attrs ?? {}));
  if (textblocks.has(node.type ?? '') || node.type === 'text') return countDocumentText(inlineNativeText(node));
  let result = ['githubAlert', 'disclosure'].includes(node.type ?? '') && typeof node.attrs?.title === 'string' ? countDocumentText(node.attrs.title) : empty;
  if (node.type === 'table') result = add(result, countDocumentText(caption(node.attrs ?? {})));
  for (const child of node.content ?? []) result = add(result, countNativeDocument(child));
  return result;
}

/** Immutable PM subtrees keep their totals across transactions, so editing a block only rescans that block's text. */
export function createRichDocumentCounter(): (node: ProseMirrorNode) => DocumentStatistics {
  const cache = new WeakMap<ProseMirrorNode, DocumentStatistics>();
  const inlineText = (node: ProseMirrorNode): string => {
    if (excluded.has(node.type.name) || node.type.name === 'image') return ' ';
    if (node.isText) return node.text ?? '';
    if (node.type.name === 'hardBreak') return '\n';
    const parts: string[] = [];
    node.forEach(child => parts.push(inlineText(child)));
    return parts.join('');
  };
  const count = (node: ProseMirrorNode): DocumentStatistics => {
    const cached = cache.get(node); if (cached) return cached;
    let result: DocumentStatistics;
    if (excluded.has(node.type.name)) result = empty;
    else if (node.type.name === 'image') result = countDocumentText(caption(node.attrs));
    else if (node.isTextblock || node.isText) result = countDocumentText(inlineText(node));
    else {
      result = ['githubAlert', 'disclosure'].includes(node.type.name) && typeof node.attrs.title === 'string' ? countDocumentText(node.attrs.title) : empty;
      if (node.type.name === 'table') result = add(result, countDocumentText(caption(node.attrs)));
      node.forEach(child => { result = add(result, count(child)); });
    }
    cache.set(node, result); return result;
  };
  return count;
}
