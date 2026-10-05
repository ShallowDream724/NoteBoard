import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { initializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { GUIDE_DISCLOSURE, GUIDE_NOTE, GUIDE_WORD } from '../../src/features/learning/practiceCourse';
import { findPracticeText } from '../../src/features/learning/practiceDetection';
import { guideTextTarget, guideUICompleted, practiceAnnotationDraft, resolveGuideTarget, visibleGuideElement } from '../../src/features/learning/guideTargets';

const editors: Editor[] = [];
const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
function editor() {
  const value = new Editor({ extensions: buildDocumentExtensions(), content: `<p>${GUIDE_WORD}</p>` });
  initializeEditorDocument(value, encodeNativeDocument(value.getJSON()), 'noteboard', '', 'showcase');
  editors.push(value); document.body.append(value.view.dom); return value;
}
function visible(element: HTMLElement, left = 100, top = 120, width = 120, height = 30) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, width, height)); return element;
}
function draft(value: Editor, key = 'showcase', range = findPracticeText(value.state.doc, GUIDE_WORD)!) {
  const panel = visible(document.createElement('div'), 90, 110, 240, 110);
  panel.className = 'nb-annotation-panel'; panel.dataset.shortcutsSuspended = 'true'; panel.dataset.annotationEditorKey = key;
  panel.dataset.annotationTargetFrom = String(range.from); panel.dataset.annotationTargetTo = String(range.to);
  const cancel = visible(document.createElement('button'), 280, 115, 30, 30); cancel.setAttribute('aria-label', '取消编辑'); panel.append(cancel);
  document.body.append(panel); return panel;
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
  const value = editor(), panel = document.createElement('div'); panel.dataset.annotationPanel = GUIDE_NOTE; panel.dataset.annotationEditorKey = 'showcase'; document.body.append(panel);
  expect(guideUICompleted(value, 'read-note')).toBe(false); visible(panel);
  expect(guideUICompleted(value, 'read-note')).toBe(true);
  draft(value);
  expect(guideUICompleted(value, 'annotation-open')).toBe(true);
  const note = visible(document.createElement('button')); note.setAttribute('aria-label', 'Note，快捷触发词 /note'); document.body.append(note);
  expect(guideUICompleted(value, 'insert-menu')).toBe(true); note.style.display = 'none';
  expect(guideUICompleted(value, 'insert-menu')).toBe(false);
  note.style.display = ''; note.setAttribute('aria-label', 'Note');
  expect(guideUICompleted(value, 'insert-menu')).toBe(false);
});
it('outlines the explanation panel once, including its editor and Save action', () => {
  const value = editor(), panel = draft(value);
  const body = visible(document.createElement('div')); body.className = 'nb-annotation-richtext'; body.setAttribute('contenteditable', 'true');
  const save = visible(document.createElement('button'), 220, 170, 60, 30); save.className = 'nb-annotation-save'; panel.append(body, save);
  expect(resolveGuideTarget(value, 'annotation-save').rects).toEqual([{ left: 90, top: 110, width: 240, height: 110 }]);
  expect(resolveGuideTarget(value, 'annotation-save').element).toBe(panel);
  expect(resolveGuideTarget(value, 'annotation-save').fallback).toBeUndefined();
});
it('returns to the real Add explanation control after a draft is cancelled', () => {
  const value = editor(), toolbar = document.createElement('div'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '文字工具栏');
  value.commands.setTextSelection(findPracticeText(value.state.doc, GUIDE_WORD)!);
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
  value.commands.setTextSelection(findPracticeText(value.state.doc, GUIDE_WORD)!);
  top.className = 'responsive-toolbar'; bubble.setAttribute('role', 'toolbar'); bubble.setAttribute('aria-label', '文字工具栏');
  const hidden = visible(document.createElement('button')), shown = visible(document.createElement('button'));
  for (const button of [hidden, shown]) button.setAttribute('aria-label', '应用文字颜色与高亮');
  hidden.style.visibility = 'hidden'; top.append(hidden); bubble.append(shown); document.body.append(top, bubble);
  expect(resolveGuideTarget(value, 'highlight').element).toBe(shown);
});
it('keeps the text as the anchor while the hidden top control hands off to an unmounted selection toolbar', () => {
  const value = editor(); value.commands.setTextSelection(findPracticeText(value.state.doc, GUIDE_WORD)!);
  const top = document.createElement('div'); top.className = 'responsive-toolbar';
  const hidden = visible(document.createElement('button')); hidden.setAttribute('aria-label', '应用文字颜色与高亮');
  top.setAttribute('aria-hidden', 'true'); top.append(hidden); document.body.append(top);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(100, 120, 100, 20)] });
  expect(resolveGuideTarget(value, 'highlight')).toEqual({ element: value.view.dom.querySelector('p'), rects: [{ left: 100, top: 120, width: 100, height: 20 }] });
});
it.each(['highlight', 'annotation-open', 'annotation-save'])('returns %s to the full text when only part of the phrase is selected', step => {
  const value = editor(), range = findPracticeText(value.state.doc, GUIDE_WORD)!;
  value.commands.setTextSelection({ from: range.from, to: range.to - 1 });
  const toolbar = document.createElement('div'); toolbar.className = 'responsive-toolbar';
  for (const label of ['应用文字颜色与高亮', '添加说明']) {
    const button = visible(document.createElement('button')); button.setAttribute('aria-label', label); toolbar.append(button);
  }
  document.body.append(toolbar);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(100, 120, 100, 20)] });
  const target = resolveGuideTarget(value, step);
  expect(target.element).toBe(value.view.dom.querySelector('p')); expect(target.fallback).toBe('selection');
  expect(target.rects).toEqual([{ left: 100, top: 120, width: 100, height: 20 }]);
});
it('ignores drafts and opened notes belonging to another editor', () => {
  const value = editor(), panel = draft(value, 'other'); panel.dataset.annotationPanel = GUIDE_NOTE;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(100, 120, 100, 20)] });
  expect(practiceAnnotationDraft(value)).toBeNull();
  expect(guideUICompleted(value, 'annotation-open')).toBe(false); expect(guideUICompleted(value, 'read-note')).toBe(false);
  const target = resolveGuideTarget(value, 'annotation-save');
  expect(target.element).toBe(value.view.dom.querySelector('p')); expect(target.fallback).toBe('selection');
});
it.each(['short', 'invalid'])('points an owned %s draft at its actual Cancel control without completing annotation-open', kind => {
  const value = editor(), range = findPracticeText(value.state.doc, GUIDE_WORD)!;
  const panel = draft(value, 'showcase', kind === 'short' ? { ...range, to: range.to - 1 } : range);
  if (kind === 'invalid') panel.dataset.annotationTargetInvalid = 'true';
  value.commands.setTextSelection(range);
  expect(practiceAnnotationDraft(value)).toEqual({ panel, matches: false });
  expect(guideUICompleted(value, 'annotation-open')).toBe(false);
  for (const step of ['annotation-open', 'annotation-save']) {
    const target = resolveGuideTarget(value, step);
    expect(target.element).toBe(panel.querySelector('button')); expect(target.fallback).toBe('annotation-target');
    expect(target.rects).toEqual([{ left: 280, top: 115, width: 30, height: 30 }]);
  }
});
it('accepts the captured full phrase while focus and the current caret are inside the draft body', () => {
  const value = editor(), range = findPracticeText(value.state.doc, GUIDE_WORD)!, panel = draft(value);
  const body = document.createElement('div'); body.setAttribute('contenteditable', 'true'); panel.append(body);
  value.commands.setTextSelection(range.from); body.focus();
  expect(document.activeElement).toBe(body); expect(value.state.selection.empty).toBe(true);
  expect(practiceAnnotationDraft(value)).toEqual({ panel, matches: true }); expect(guideUICompleted(value, 'annotation-open')).toBe(true);
  expect(resolveGuideTarget(value, 'annotation-save').element).toBe(panel);
});
it('returns a missing-text fallback after the target phrase is edited away instead of circling an unrelated toolbar', () => {
  const value = editor(); value.commands.setContent('<p>已经改写的正文</p>');
  const toolbar = document.createElement('div'); toolbar.className = 'responsive-toolbar';
  for (const label of ['应用文字颜色与高亮', '添加说明']) {
    const button = visible(document.createElement('button')); button.setAttribute('aria-label', label); toolbar.append(button);
  }
  document.body.append(toolbar);
  for (const step of ['selection', 'highlight', 'annotation-open', 'annotation-save']) {
    expect(resolveGuideTarget(value, step)).toEqual({ element: null, rects: [], fallback: 'missing-text' });
    expect(guideUICompleted(value, step)).toBe(false);
  }
});
it.each(['aria-hidden', 'inert', 'hidden'])('ignores targets whose ancestor is %s', attribute => {
  const value = editor(), wrapper = document.createElement('div'), hidden = visible(document.createElement('button'));
  wrapper.setAttribute(attribute, attribute === 'aria-hidden' ? 'true' : ''); hidden.className = 'nb-annotation-indicator'; hidden.dataset.annotationId = GUIDE_NOTE;
  wrapper.append(hidden); value.view.dom.append(wrapper);
  expect(visibleGuideElement('.nb-annotation-indicator', value.view.dom)).toBeNull();
  expect(resolveGuideTarget(value, 'read-note').element).toBeNull();
  const shown = visible(hidden.cloneNode() as HTMLElement); value.view.dom.append(shown);
  expect(resolveGuideTarget(value, 'read-note').element).toBe(shown);
});
it('reads the intended disclosure NodeView open state', () => {
  const value = editor(), disclosure = document.createElement('section'); disclosure.className = 'nb-disclosure';
  const title = document.createElement('input'); title.className = 'nb-disclosure-title'; title.value = GUIDE_DISCLOSURE;
  const toggle = visible(document.createElement('button')); toggle.className = 'nb-disclosure-toggle'; disclosure.append(title, toggle); value.view.dom.append(disclosure);
  expect(resolveGuideTarget(value, 'disclosure').element).toBe(toggle);
  expect(guideUICompleted(value, 'disclosure')).toBe(false); disclosure.dataset.open = 'true';
  expect(guideUICompleted(value, 'disclosure')).toBe(true);
});
