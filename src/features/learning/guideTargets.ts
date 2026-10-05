import type { Editor } from '@tiptap/core';
import { GUIDE_DISCLOSURE, GUIDE_NOTE, GUIDE_WORD } from './practiceCourse';
import { findPracticeText, guideBlankPosition, guideSelectionMatches } from './practiceDetection';
import { guideInsertionRect, mergeTextRects, type GuideRect } from './guideGeometry';
import { editorDocumentKey } from '../editor-md/editorDocumentCodec';

export interface GuideTarget { element: HTMLElement | null; rects: GuideRect[]; contextRects?: GuideRect[]; fallback?: 'selection' | 'command' | 'annotation' | 'annotation-target' | 'missing-text' }
const noteCommand = 'button[aria-label="Note，快捷触发词 /note"]';
const rect = (r: DOMRect): GuideRect => ({ left: r.left, top: r.top, width: r.width, height: r.height });
function visible(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect(), style = getComputedStyle(element);
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    && !element.closest('[aria-hidden="true"],[inert],[hidden]');
}
export function visibleGuideElement(selector: string, root: ParentNode = document): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(visible) ?? null;
}
function fromElement(element: HTMLElement | null): GuideTarget {
  return { element, rects: element ? [rect(element.getBoundingClientRect())] : [] };
}
function textControlTarget(editor: Editor, button: HTMLElement): GuideTarget {
  return { ...fromElement(button), contextRects: guideTextTarget(editor).rects };
}
function blankTarget(editor: Editor): GuideTarget {
  const { selection, doc } = editor.state;
  const pos = guideBlankPosition(doc, selection.empty ? selection.head : undefined);
  if (pos === null) return { element: null, rects: [] };
  const element = editor.view.nodeDOM(pos);
  if (!(element instanceof HTMLElement)) return { element: null, rects: [] };
  try {
    const node = doc.nodeAt(pos)!;
    const input = selection.empty && selection.head >= pos + 1 && selection.head <= pos + 1 + node.content.size
      ? selection.head : pos + 1;
    const caret = editor.view.coordsAtPos(input);
    const area = guideInsertionRect({ left: caret.left, top: caret.top, width: caret.right - caret.left, height: caret.bottom - caret.top },
      rect(element.getBoundingClientRect()), parseFloat(getComputedStyle(element).fontSize));
    return { element, rects: area ? [area] : [] };
  } catch { return { element, rects: [] }; }
}
export function guideTextTarget(editor: Editor): GuideTarget {
  const positions = findPracticeText(editor.state.doc, GUIDE_WORD);
  if (!positions) return { element: null, rects: [], fallback: 'missing-text' };
  try {
    const from = editor.view.domAtPos(positions.from, 1), to = editor.view.domAtPos(positions.to, -1);
    const range = editor.view.dom.ownerDocument.createRange();
    range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
    // Whole DOM ranges also return enclosing spans and decoration widgets.
    // Measure only text belonging to the model range, then merge each line.
    const rects: GuideRect[] = [], root = range.commonAncestorContainer;
    const walker = editor.view.dom.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const measureText = (node: Node) => {
      if (!range.intersectsNode(node) || node.parentElement?.closest('[contenteditable="false"],.ProseMirror-widget,.nb-annotation-inline-marker')) return;
      const segment = editor.view.dom.ownerDocument.createRange();
      segment.setStart(node, node === range.startContainer ? range.startOffset : 0);
      segment.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent?.length ?? 0);
      rects.push(...Array.from(segment.getClientRects()).map(rect));
    };
    if (root.nodeType === Node.TEXT_NODE) measureText(root);
    else while (walker.nextNode()) measureText(walker.currentNode);
    return { element: from.node instanceof HTMLElement ? from.node : from.node.parentElement, rects: mergeTextRects(rects) };
  } catch { return { element: null, rects: [] }; }
}
function selectionTarget(editor: Editor): GuideTarget {
  const target = guideTextTarget(editor);
  return { ...target, fallback: target.fallback ?? 'selection' };
}
export function guideDisclosure(editor: Editor): HTMLElement | null {
  return Array.from(editor.view.dom.querySelectorAll<HTMLInputElement>('.nb-disclosure-title')).find(input => input.value === GUIDE_DISCLOSURE)?.closest<HTMLElement>('.nb-disclosure') ?? null;
}
/** Draft ownership and its captured range come from the annotation view model.
 * Current caret movement inside that draft must not change the saved anchor. */
export function practiceAnnotationDraft(editor: Editor): { panel: HTMLElement; matches: boolean } | null {
  const key = editorDocumentKey(editor), range = findPracticeText(editor.state.doc, GUIDE_WORD);
  if (!key) return null;
  for (const panel of document.querySelectorAll<HTMLElement>('.nb-annotation-panel[data-shortcuts-suspended="true"]')) {
    if (panel.dataset.annotationEditorKey !== key || !visible(panel)) continue;
    return { panel, matches: !!range && panel.dataset.annotationTargetInvalid !== 'true'
      && Number(panel.dataset.annotationTargetFrom) === range.from && Number(panel.dataset.annotationTargetTo) === range.to };
  }
  return null;
}
function annotationTarget(editor: Editor): GuideTarget {
  const draft = practiceAnnotationDraft(editor);
  if (draft) return draft.matches ? fromElement(draft.panel) : {
    ...fromElement(draft.panel.querySelector<HTMLElement>('button[aria-label="取消编辑"]')), fallback: 'annotation-target',
  };
  if (!guideSelectionMatches(editor.state)) return selectionTarget(editor);
  const button = visibleGuideElement('[role="toolbar"][aria-label="文字工具栏"] button[aria-label="添加说明"]')
    ?? visibleGuideElement('.responsive-toolbar button[aria-label="添加说明"]');
  return button ? textControlTarget(editor, button) : selectionTarget(editor);
}
export function resolveGuideTarget(editor: Editor, step: string): GuideTarget {
  if (step === 'read-note') return fromElement(visibleGuideElement(`[data-annotation-id="${GUIDE_NOTE}"].nb-annotation-indicator`, editor.view.dom));
  if (step === 'highlight') {
    if (!guideSelectionMatches(editor.state)) return selectionTarget(editor);
    const button = visibleGuideElement('.responsive-toolbar button[aria-label="应用文字颜色与高亮"]')
      ?? visibleGuideElement('[role="toolbar"][aria-label="文字工具栏"] button[aria-label="应用文字颜色与高亮"]');
    // A responsive control can disappear before the selection toolbar mounts.
    // Keep the sample unobscured during that handoff instead of centering a card.
    return button ? textControlTarget(editor, button) : guideTextTarget(editor);
  }
  if (step === 'annotation-open') {
    return annotationTarget(editor);
  }
  if (step === 'annotation-save') {
    const entry = annotationTarget(editor);
    if (entry.element?.matches('.nb-annotation-panel') && !entry.fallback) return entry;
    return { ...entry, fallback: entry.fallback ?? 'annotation' };
  }
  if (step === 'insert-menu') return blankTarget(editor);
  if (step === 'insert-callout') {
    const button = visibleGuideElement(noteCommand);
    return button ? fromElement(button) : { ...blankTarget(editor), fallback: 'command' };
  }
  if (step === 'disclosure') return fromElement(guideDisclosure(editor)?.querySelector<HTMLElement>('.nb-disclosure-toggle') ?? null);
  return guideTextTarget(editor);
}
export function guideUICompleted(editor: Editor, step: string): boolean {
  if (step === 'read-note') { const key = editorDocumentKey(editor); return !!key && Array.from(document.querySelectorAll<HTMLElement>(`[data-annotation-panel="${GUIDE_NOTE}"]`))
    .some(panel => panel.dataset.annotationEditorKey === key && visible(panel)); }
  if (step === 'annotation-open') return practiceAnnotationDraft(editor)?.matches === true;
  if (step === 'insert-menu') return !!visibleGuideElement(noteCommand);
  if (step === 'disclosure') return guideDisclosure(editor)?.dataset.open === 'true';
  return false;
}
