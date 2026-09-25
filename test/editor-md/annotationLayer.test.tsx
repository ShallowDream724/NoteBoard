import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TooltipProvider } from '@/components/Tooltip';
import { annotationSchemaExtensions } from '@/features/editor-md/annotations/schema';
import { AnnotationBehavior } from '@/features/editor-md/annotations/extension';
import { AnnotationLayer } from '@/features/editor-md/annotations/AnnotationLayer';
import { beginAnnotation } from '@/features/editor-md/annotations/commands';
import { annotationAnchors, collectAnnotations } from '@/features/editor-md/annotations/model';
import { undoDepth } from '@tiptap/pm/history';
import { EditorView } from '@tiptap/pm/view';

let editor: Editor, root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no Range layout; these cases exercise document and focus behavior.
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  const boundary = document.createElement('div'); boundary.dataset.editorScroll = 'true'; document.body.append(boundary);
  vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 50, right: 840, bottom: 650, width: 800, height: 600, x: 40, y: 50, toJSON: () => ({}) });
  const editorHost = document.createElement('div'); boundary.append(editorHost);
  editor = new Editor({ element: editorHost, extensions: [StarterKit, ...annotationSchemaExtensions, AnnotationBehavior], content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Read this note', marks: [{ type: 'annotationReference', attrs: { id: 'example' } }] }] },
    { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'example' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A useful explanation' }] }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'New anchor words' }] },
  ] } });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<TooltipProvider><AnnotationLayer editor={editor}/></TooltipProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount()); editor.destroy(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const pointer = (element: Element, type: string) => element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const anchor = () => editor.view.dom.querySelector<HTMLElement>('.nb-annotation-anchor')!;
const panel = () => document.querySelector<HTMLElement>('.nb-annotation-panel');
function targetRange() {
  let from = 0;
  editor.state.doc.forEach((node, pos) => { if (node.type.name === 'paragraph' && !node.firstChild?.marks.length) from = pos + 1; });
  return { from, to: from + 10 };
}
async function enterBody(text: string) {
  const field = panel()!.querySelector<HTMLElement>('.nb-annotation-richtext')!;
  await act(async () => {
    const paragraph = document.createElement('p'); paragraph.textContent = text; field.replaceChildren(paragraph);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await Promise.resolve(); vi.advanceTimersByTime(30);
  });
  return field;
}

it('keeps the hover panel open across the anchor-to-panel gap, then closes outside', async () => {
  await act(async () => { pointer(anchor(), 'pointerover'); vi.advanceTimersByTime(280); });
  expect(panel()?.textContent).toContain('A useful explanation');
  await act(async () => { pointer(anchor(), 'pointerout'); vi.advanceTimersByTime(100); pointer(panel()!, 'pointerover'); vi.advanceTimersByTime(500); });
  expect(panel()).not.toBeNull();
  await act(async () => pointer(document.body, 'pointerdown'));
  expect(panel()).toBeNull();
});

it('pins a window without changing document content, and supports keyboard closing with focus restoration', async () => {
  const original = editor.getJSON();
  await act(async () => anchor().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="固定说明"]')!.click());
  await act(async () => { pointer(document.body, 'pointerdown'); vi.advanceTimersByTime(500); });
  expect(panel()?.dataset.pinned).toBe('true');
  expect(editor.getJSON()).toEqual(original);
  await act(async () => panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(anchor());
});

it('opens a keyboard anchor without letting Enter insert document content', async () => {
  const original = editor.getJSON();
  await act(async () => {
    anchor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(20);
  });
  expect(panel()).not.toBeNull();
  expect(editor.getJSON()).toEqual(original);
});

it.each(['取消', 'Escape'])('discards a new draft with %s without creating an anchor, body or undo event', async action => {
  const original = editor.getJSON(), depth = undoDepth(editor.state);
  await act(async () => { editor.commands.setTextSelection(targetRange()); expect(beginAnnotation(editor)).not.toBeNull(); });
  await enterBody('A draft to discard');
  expect(editor.getJSON()).toEqual(original);
  await act(async () => {
    if (action === 'Escape') panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else Array.from(panel()!.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '取消')!.click();
  });
  expect(panel()).toBeNull();
  expect(editor.getJSON()).toEqual(original);
  expect(undoDepth(editor.state)).toBe(depth);
});

it('saves a new rich draft and anchor as one undoable parent-document action', async () => {
  const original = editor.state.doc;
  let id = '';
  await act(async () => { editor.commands.setTextSelection(targetRange()); id = beginAnnotation(editor)!; });
  await enterBody('Saved explanation');
  await act(async () => panel()!.querySelector<HTMLButtonElement>('.nb-annotation-save')!.click());
  expect(collectAnnotations(editor.state.doc).get(id)?.node.textContent).toBe('Saved explanation');
  expect(panel()?.querySelector('[data-annotation-edit]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(20));
  expect(document.activeElement).toBe(panel()?.querySelector('[data-annotation-edit]'));
  expect(undoDepth(editor.state)).toBe(1);
  await act(async () => { editor.commands.undo(); });
  expect(editor.state.doc.eq(original)).toBe(true);
  await act(async () => { editor.commands.redo(); });
  expect(collectAnnotations(editor.state.doc).get(id)?.node.textContent).toBe('Saved explanation');
});

it('maps a new draft target through main-document edits before saving', async () => {
  const target = targetRange(); let id = '';
  await act(async () => {
    editor.commands.setTextSelection(target); id = beginAnnotation(editor)!;
    editor.view.dispatch(editor.state.tr.insertText('Prefix ', target.from));
  });
  const beforeSave = editor.state.doc;
  await act(async () => panel()!.querySelector<HTMLButtonElement>('.nb-annotation-save')!.click());
  const anchor = annotationAnchors(editor.state.doc).find(value => value.id === id)!;
  expect(editor.state.doc.textBetween(anchor.from, anchor.to)).toBe('New anchor');
  await act(async () => { editor.commands.undo(); });
  expect(editor.state.doc.eq(beforeSave)).toBe(true);
});

it('keeps a draft after its target is deleted and lets the user attach it to a new selection', async () => {
  const target = targetRange(); let id = '';
  await act(async () => { editor.commands.setTextSelection(target); id = beginAnnotation(editor)!; });
  const field = await enterBody('Keep this explanation');
  await act(async () => { editor.commands.deleteRange(target); });
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain('原选区已删除');
  expect(panel()?.querySelector('.nb-annotation-richtext')).toBe(field);
  await act(async () => panel()!.querySelector<HTMLButtonElement>('.nb-annotation-save')!.click());
  expect(collectAnnotations(editor.state.doc).has(id)).toBe(false);
  await act(async () => {
    editor.commands.setTextSelection({ from: target.from, to: target.from + 6 });
    Array.from(panel()!.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '使用当前选区')!.click();
  });
  await act(async () => panel()!.querySelector<HTMLButtonElement>('.nb-annotation-save')!.click());
  expect(collectAnnotations(editor.state.doc).get(id)?.node.textContent).toBe('Keep this explanation');
});
