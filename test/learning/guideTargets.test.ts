import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { GUIDE_DISCLOSURE, GUIDE_NOTE, GUIDE_WORD } from '../../src/features/learning/practiceCourse';
import { guideTextTarget, guideUICompleted, resolveGuideTarget, visibleGuideElement } from '../../src/features/learning/guideTargets';

const editors: Editor[] = [];
const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
function editor() {
  const value = new Editor({ extensions: buildDocumentExtensions(), content: `<p>${GUIDE_WORD}</p>` });
  editors.push(value); document.body.append(value.view.dom); return value;
}
function visible(element: HTMLElement, left = 100, top = 120, width = 120, height = 30) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, width, height)); return element;
}
afterEach(() => {
  editors.splice(0).forEach(value => value.destroy()); document.body.replaceChildren(); vi.restoreAllMocks();
  if (originalClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalClientRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

it('keeps the individual rectangles of a phrase wrapped over two lines', () => {
  const value = editor();
  const rects = [new DOMRect(100, 120, 100, 20), new DOMRect(100, 144, 50, 20), new DOMRect(0, 0, 0, 0)];
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: vi.fn(() => rects) });
  const target = guideTextTarget(value);
  expect(target.rects).toEqual([{ left: 100, top: 120, width: 100, height: 20 }, { left: 100, top: 144, width: 50, height: 20 }]);
  expect(target.element).toBe(value.view.dom.querySelector('p'));
});
it('targets only the note indicator inside the owned editor and ignores hidden UI', () => {
  const value = editor(), outside = visible(document.createElement('button'));
  outside.className = 'nb-annotation-indicator'; outside.dataset.annotationId = GUIDE_NOTE; document.body.append(outside);
  expect(resolveGuideTarget(value, 'read-note').element).toBeNull();
  const inside = outside.cloneNode() as HTMLElement; value.view.dom.append(inside); visible(inside);
  expect(resolveGuideTarget(value, 'read-note').element).toBe(inside);
  inside.style.visibility = 'hidden'; expect(resolveGuideTarget(value, 'read-note').element).toBeNull();
  expect(visibleGuideElement('.nb-annotation-indicator', value.view.dom)).toBeNull();
});
it('requires visible opened note, annotation editor and slash results for UI steps', () => {
  const value = editor(), panel = document.createElement('div'); panel.dataset.annotationPanel = GUIDE_NOTE; document.body.append(panel);
  expect(guideUICompleted(value, 'read-note')).toBe(false); visible(panel);
  expect(guideUICompleted(value, 'read-note')).toBe(true);
  panel.className = 'nb-annotation-panel'; panel.dataset.shortcutsSuspended = 'true';
  expect(guideUICompleted(value, 'annotation-open')).toBe(true);
  const note = visible(document.createElement('button')); note.setAttribute('aria-label', 'Note，快捷触发词 /note'); document.body.append(note);
  expect(guideUICompleted(value, 'insert-menu')).toBe(true); note.style.display = 'none';
  expect(guideUICompleted(value, 'insert-menu')).toBe(false);
  note.style.display = ''; note.setAttribute('aria-label', 'Note');
  expect(guideUICompleted(value, 'insert-menu')).toBe(false);
});
it('combines the actual explanation editor and Save button as the target', () => {
  const value = editor(), panel = visible(document.createElement('div')); panel.className = 'nb-annotation-panel'; panel.dataset.shortcutsSuspended = 'true';
  const body = visible(document.createElement('div')); body.className = 'nb-annotation-richtext'; body.setAttribute('contenteditable', 'true');
  const save = visible(document.createElement('button'), 220, 170, 60, 30); save.className = 'nb-annotation-save'; panel.append(body, save); document.body.append(panel);
  expect(resolveGuideTarget(value, 'annotation-save').rects).toHaveLength(2);
  expect(resolveGuideTarget(value, 'annotation-save').element).toBe(body);
});
it('reads the intended disclosure NodeView open state', () => {
  const value = editor(), disclosure = document.createElement('section'); disclosure.className = 'nb-disclosure';
  const title = document.createElement('input'); title.className = 'nb-disclosure-title'; title.value = GUIDE_DISCLOSURE;
  const toggle = visible(document.createElement('button')); toggle.className = 'nb-disclosure-toggle'; disclosure.append(title, toggle); value.view.dom.append(disclosure);
  expect(resolveGuideTarget(value, 'disclosure').element).toBe(toggle);
  expect(guideUICompleted(value, 'disclosure')).toBe(false); disclosure.dataset.open = 'true';
  expect(guideUICompleted(value, 'disclosure')).toBe(true);
});
