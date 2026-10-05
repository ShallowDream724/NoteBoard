import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { GUIDE_DISCLOSURE, GUIDE_WORD } from './practiceCourse';
import { editorDocumentKey } from '../editor-md/editorDocumentCodec';

export function ownsPracticeEditor(editor: Editor | null, key: string | null): editor is Editor {
  return !!editor && !editor.isDestroyed && !!key && editorDocumentKey(editor) === key;
}
export interface TextRange { from: number; to: number }
/** Only the owned sample is searched; inline atoms occupy one model position. */
export function findPracticeText(doc: Node, text: string): TextRange | null {
  let range: TextRange | null = null;
  doc.descendants((node, pos) => {
    if (range || node.type.name === 'annotationStore' || node.type.name === 'documentPresentation') return false;
    if (!node.isTextblock) return;
    const at = node.textBetween(0, node.content.size, '', '\ufffc').indexOf(text);
    if (at >= 0) range = { from: pos + 1 + at, to: pos + 1 + at + text.length };
    return false;
  });
  return range;
}
export function guideBlankPosition(doc: Node): number | null {
  let found: number | null = null;
  doc.forEach((node, pos) => {
    if (found === null && node.type.name === 'paragraph' && (!node.content.size || /^\/\w*$/.test(node.textContent))) found = pos;
  });
  return found;
}
export function guideCalloutCount(doc: Node): number {
  let count = 0;
  doc.descendants(node => { if (node.type.name === 'annotationStore') return false; if (node.type.name === 'githubAlert') count++; });
  return count;
}
export function guideSelectionMatches(state: EditorState): boolean {
  const range = findPracticeText(state.doc, GUIDE_WORD), { selection } = state;
  return !!range && selection.from === range.from && selection.to === range.to && !selection.empty;
}
export function guideTaskSatisfied(id: string, state: EditorState, initialCallouts: number): boolean {
  const { doc } = state, range = findPracticeText(doc, GUIDE_WORD);
  if (id === 'selection') return guideSelectionMatches(state);
  if (id === 'highlight' && range) {
    let covered = 0;
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.isText && node.marks.some(mark => mark.type.name === 'highlight')) covered += Math.max(0, Math.min(range.to, pos + node.nodeSize) - Math.max(range.from, pos));
    });
    return covered === GUIDE_WORD.length;
  }
  if ((id === 'annotation-save' || id === 'annotation-open') && range) {
    const ids = new Set<string>(), coverage = new Map<string, number>();
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (typeof node.attrs.annotationId === 'string') ids.add(node.attrs.annotationId);
      for (const mark of node.marks) if (node.isText && mark.type.name === 'annotationReference') {
        const length = Math.max(0, Math.min(range.to, pos + node.nodeSize) - Math.max(range.from, pos));
        coverage.set(mark.attrs.id, (coverage.get(mark.attrs.id) ?? 0) + length);
      }
    });
    for (const [id, length] of coverage) if (length === GUIDE_WORD.length) ids.add(id);
    let saved = false;
    // Drafts live in a separate editor. A linked body in the owned document is
    // the Save result, including an intentionally empty or whitespace-only body.
    doc.descendants(node => { if (node.type.name === 'annotationBody' && ids.has(node.attrs.id)) saved = true; return !saved; });
    return saved;
  }
  if (id === 'insert-menu' || id === 'insert-callout') return guideCalloutCount(doc) > initialCallouts;
  if (id === 'disclosure') {
    let open = false;
    doc.descendants(node => { if (node.type.name === 'disclosure' && node.attrs.title === GUIDE_DISCLOSURE && node.attrs.open) open = true; return !open; });
    return open;
  }
  return false;
}
