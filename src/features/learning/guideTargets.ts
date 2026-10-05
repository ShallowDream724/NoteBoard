import type { Editor } from '@tiptap/core';
import { GUIDE_DISCLOSURE, GUIDE_NOTE, GUIDE_WORD } from './practiceCourse';
import { findPracticeText, guideBlankPosition } from './practiceDetection';
import type { GuideRect } from './guideGeometry';

export interface GuideTarget { element: HTMLElement | null; rects: GuideRect[]; fallback?: 'selection' | 'command' }
const noteCommand = 'button[aria-label="Note，快捷触发词 /note"]';
const rect = (r: DOMRect): GuideRect => ({ left: r.left, top: r.top, width: r.width, height: r.height });
export function visibleGuideElement(selector: string, root: ParentNode = document): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }) ?? null;
}
function fromElement(element: HTMLElement | null): GuideTarget {
  return { element, rects: element ? [rect(element.getBoundingClientRect())] : [] };
}
function blankTarget(editor: Editor): GuideTarget {
  const pos = guideBlankPosition(editor.state.doc);
  const target = fromElement(pos === null ? null : editor.view.nodeDOM(pos) as HTMLElement | null);
  // The drag handle can overlap the first few pixels of an empty paragraph.
  // Point to its safe writing area, not the handle's hit area.
  target.rects = target.rects.map(r => ({ ...r, left: r.left + 28, width: Math.max(1, r.width - 40) }));
  return target;
}
export function guideTextTarget(editor: Editor): GuideTarget {
  const positions = findPracticeText(editor.state.doc, GUIDE_WORD);
  if (!positions) return { element: null, rects: [] };
  try {
    const from = editor.view.domAtPos(positions.from, 1), to = editor.view.domAtPos(positions.to, -1);
    const range = editor.view.dom.ownerDocument.createRange();
    range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0).map(rect);
    return { element: from.node instanceof HTMLElement ? from.node : from.node.parentElement, rects };
  } catch { return { element: null, rects: [] }; }
}
export function guideDisclosure(editor: Editor): HTMLElement | null {
  return Array.from(editor.view.dom.querySelectorAll<HTMLInputElement>('.nb-disclosure-title')).find(input => input.value === GUIDE_DISCLOSURE)?.closest<HTMLElement>('.nb-disclosure') ?? null;
}
export function resolveGuideTarget(editor: Editor, step: string): GuideTarget {
  if (step === 'read-note') return fromElement(visibleGuideElement(`[data-annotation-id="${GUIDE_NOTE}"].nb-annotation-indicator`, editor.view.dom));
  if (step === 'highlight') return fromElement(visibleGuideElement('.responsive-toolbar button[aria-label="应用文字颜色与高亮"]')
    ?? visibleGuideElement('[role="toolbar"][aria-label="文字工具栏"] button[aria-label="应用文字颜色与高亮"]'));
  if (step === 'annotation-open') {
    const button = visibleGuideElement('[role="toolbar"][aria-label="文字工具栏"] button[aria-label="添加说明"]')
      ?? visibleGuideElement('.responsive-toolbar button[aria-label="添加说明"]');
    return button ? fromElement(button) : { ...guideTextTarget(editor), fallback: 'selection' };
  }
  if (step === 'annotation-save') {
    const panel = visibleGuideElement('.nb-annotation-panel[data-shortcuts-suspended="true"]');
    const body = panel?.querySelector<HTMLElement>('.nb-annotation-richtext[contenteditable="true"]');
    if (body) {
      const target = fromElement(body), save = panel?.querySelector<HTMLElement>('.nb-annotation-save');
      if (save) target.rects.push(rect(save.getBoundingClientRect()));
      return target;
    }
    return guideTextTarget(editor);
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
  if (step === 'read-note') return !!visibleGuideElement(`[data-annotation-panel="${GUIDE_NOTE}"]`);
  if (step === 'annotation-open') return !!visibleGuideElement('.nb-annotation-panel[data-shortcuts-suspended="true"]');
  if (step === 'insert-menu') return !!visibleGuideElement(noteCommand);
  if (step === 'disclosure') return guideDisclosure(editor)?.dataset.open === 'true';
  return false;
}
