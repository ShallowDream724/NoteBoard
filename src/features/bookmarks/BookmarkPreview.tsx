import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderMath } from '../editor-md/mathRendering';
import type { DocumentBookmark } from './types';

export interface BookmarkPreviewPart { text: string; strong?: boolean; emphasis?: boolean; code?: boolean; math?: boolean }
const MAX_CHARACTERS = 160, MAX_PARTS = 48, MAX_STEPS = 256, MAX_MATH_SOURCE = 512;

/** Resolve directly at the anchor, then read a bounded prefix. Never clone a
 * selected slice: a bookmark may cover an entire document or a huge table. */
export function bookmarkPreviewParts(doc: PMNode, record: DocumentBookmark): BookmarkPreviewPart[] {
  if (record.missing || record.pos < 0 || record.pos > doc.content.size) return [{ text: record.label }];
  const parts: BookmarkPreviewPart[] = [];
  let cursor = record.pos, remaining = MAX_CHARACTERS;
  const end = Math.min(doc.content.size, cursor + record.size);
  const append = (part: BookmarkPreviewPart) => {
    const text = part.text.slice(0, part.math ? MAX_MATH_SOURCE : remaining).replace(part.math ? /\r/g : /\s+/g, part.math ? '' : ' ');
    if (!text) return;
    parts.push({ ...part, text }); remaining -= part.math ? 24 : text.length;
  };
  for (let step = 0; cursor < end && remaining > 0 && parts.length < MAX_PARTS && step < MAX_STEPS; step++) {
    const at = doc.resolve(cursor), node = at.parent.maybeChild(at.index());
    if (!node) { cursor++; continue; }
    if (node.isText) {
      const count = Math.min(end - cursor, node.nodeSize - at.textOffset);
      append({ text: (node.text ?? '').slice(at.textOffset, at.textOffset + Math.min(count, remaining)),
        strong: node.marks.some(mark => mark.type.name === 'bold'),
        emphasis: node.marks.some(mark => mark.type.name === 'italic'),
        code: node.marks.some(mark => mark.type.name === 'code') });
      cursor += count;
    } else if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') {
      const source = String(node.attrs.latex ?? '');
      append({ text: source, math: source.length <= MAX_MATH_SOURCE }); cursor += node.nodeSize;
    } else if (node.isLeaf) {
      append({ text: node.type.name === 'hardBreak' ? ' ' : String(node.attrs.alt || (node.type.name === 'image' ? '图片' : '')) });
      cursor += node.nodeSize;
    } else {
      if (node.isBlock && parts.length) append({ text: ' ' });
      cursor++;
    }
  }
  return parts.length ? parts : [{ text: record.label }];
}

let observer: IntersectionObserver | undefined;
const waiting = new Map<Element, () => void>();
function observePreview(element: Element, ready: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') { ready(); return () => {}; }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) waiting.get(entry.target)?.();
  }, { rootMargin: '80px' });
  waiting.set(element, ready); observer.observe(element);
  return () => {
    waiting.delete(element); observer?.unobserve(element);
    if (!waiting.size) { observer?.disconnect(); observer = undefined; }
  };
}

const PreviewMath = memo(function PreviewMath({ source }: { source: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [html, setHtml] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let requested = false;
    setHtml('');
    const stop = observePreview(ref.current!, () => {
      if (requested) return; requested = true;
      void renderMath(source, false, { signal: controller.signal, priority: () => 3 }).then(result => {
        if (!controller.signal.aborted && !result.error) setHtml(result.html);
      }).catch(() => {});
    });
    return () => { stop(); controller.abort(); };
  }, [source]);
  return <span ref={ref} className="nb-bookmark-math" aria-label={source}>{html ? <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }}/> : source}</span>;
});

export const BookmarkPreview = memo(function BookmarkPreview({ doc, record }: { doc: PMNode; record: DocumentBookmark }) {
  const parts = useMemo(() => bookmarkPreviewParts(doc, record), [doc, record]);
  return <span className="nb-bookmark-preview">{parts.map((part, index) => {
    if (part.math) return <PreviewMath key={index} source={part.text}/>;
    let text: ReactNode = part.text;
    if (part.code) text = <code>{text}</code>;
    if (part.emphasis) text = <em>{text}</em>;
    if (part.strong) text = <strong>{text}</strong>;
    return <span key={index}>{text}</span>;
  })}</span>;
});
