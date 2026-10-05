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
it('measures only the selected text fragments and merges split marks without including annotation widgets', () => {
  const value = editor(); value.commands.setContent(`<p>前<strong>${GUIDE_WORD.slice(0, 3)}</strong>${GUIDE_WORD.slice(3)}后</p>`);
  const strong = value.view.dom.querySelector('strong')!;
  const indicator = document.createElement('span'); indicator.setAttribute('contenteditable', 'false'); indicator.textContent = '?';
  strong.append(indicator);
  const widget = document.createElement('span'); widget.className = 'ProseMirror-widget'; widget.textContent = '?'; strong.append(widget);
  const measured: string[] = [];
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function(this: Range) {
    const text = this.toString(); measured.push(text);
    if (this.startContainer !== this.endContainer || this.startContainer.nodeType !== Node.TEXT_NODE) return [new DOMRect(0, 0, 1000, 500)];
    if (text === GUIDE_WORD.slice(0, 3)) return [new DOMRect(100, 120, 60, 20), new DOMRect(100, 120, 60, 20)];
    if (text === GUIDE_WORD.slice(3)) return [new DOMRect(160, 120, 60, 20)];
    return [new DOMRect(300, 100, 80, 40)];
  } });
  expect(guideTextTarget(value).rects).toEqual([{ left: 100, top: 120, width: 120, height: 20 }]);
  expect(measured.join('')).toBe(GUIDE_WORD);
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
it('outlines the explanation panel once, including its editor and Save action', () => {
  const value = editor(), panel = visible(document.createElement('div'), 90, 110, 240, 110); panel.className = 'nb-annotation-panel'; panel.dataset.shortcutsSuspended = 'true';
  const body = visible(document.createElement('div')); body.className = 'nb-annotation-richtext'; body.setAttribute('contenteditable', 'true');
  const save = visible(document.createElement('button'), 220, 170, 60, 30); save.className = 'nb-annotation-save'; panel.append(body, save); document.body.append(panel);
  expect(resolveGuideTarget(value, 'annotation-save').rects).toEqual([{ left: 90, top: 110, width: 240, height: 110 }]);
  expect(resolveGuideTarget(value, 'annotation-save').element).toBe(panel);
});
it('returns to the real Add explanation control after a draft is cancelled', () => {
  const value = editor(), toolbar = document.createElement('div'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '文字工具栏');
  const add = visible(document.createElement('button')); add.setAttribute('aria-label', '添加说明'); toolbar.append(add); document.body.append(toolbar);
  const indicator = visible(document.createElement('button')); indicator.className = 'nb-annotation-indicator'; value.view.dom.append(indicator);
  const target = resolveGuideTarget(value, 'annotation-save');
  expect(target.element).toBe(add);
  expect(target.rects).toEqual([{ left: 100, top: 120, width: 120, height: 30 }]);
});
it('asks for a fresh selection after cancellation when no Add explanation control is visible', () => {
  const value = editor(), toolbar = document.createElement('div'); toolbar.className = 'responsive-toolbar';
  const add = visible(document.createElement('button')); add.setAttribute('aria-label', '添加说明'); add.style.visibility = 'hidden'; toolbar.append(add); document.body.append(toolbar);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(100, 120, 100, 20)] });
  const target = resolveGuideTarget(value, 'annotation-save');
  expect(target.element).toBe(value.view.dom.querySelector('p')); expect(target.fallback).toBe('selection');
  expect(target.rects).toEqual([{ left: 100, top: 120, width: 100, height: 20 }]);
});
it('points to the floating highlight control when the responsive toolbar hides it', () => {
  const value = editor(), top = document.createElement('div'), bubble = document.createElement('div');
  top.className = 'responsive-toolbar'; bubble.setAttribute('role', 'toolbar'); bubble.setAttribute('aria-label', '文字工具栏');
  const hidden = visible(document.createElement('button')), shown = visible(document.createElement('button'));
  for (const button of [hidden, shown]) button.setAttribute('aria-label', '应用文字颜色与高亮');
  hidden.style.visibility = 'hidden'; top.append(hidden); bubble.append(shown); document.body.append(top, bubble);
  expect(resolveGuideTarget(value, 'highlight').element).toBe(shown);
});
it('reads the intended disclosure NodeView open state', () => {
  const value = editor(), disclosure = document.createElement('section'); disclosure.className = 'nb-disclosure';
  const title = document.createElement('input'); title.className = 'nb-disclosure-title'; title.value = GUIDE_DISCLOSURE;
  const toggle = visible(document.createElement('button')); toggle.className = 'nb-disclosure-toggle'; disclosure.append(title, toggle); value.view.dom.append(disclosure);
  expect(resolveGuideTarget(value, 'disclosure').element).toBe(toggle);
  expect(guideUICompleted(value, 'disclosure')).toBe(false); disclosure.dataset.open = 'true';
  expect(guideUICompleted(value, 'disclosure')).toBe(true);
});
