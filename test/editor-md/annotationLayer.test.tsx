import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TooltipProvider } from '@/components/Tooltip';
import { annotationSchemaExtensions } from '@/features/editor-md/annotations/schema';
import { AnnotationBehavior } from '@/features/editor-md/annotations/extension';
import { AnnotationLayer } from '@/features/editor-md/annotations/AnnotationLayer';
import { beginAnnotation, addAnnotation, dismissTransientAnnotations } from '@/features/editor-md/annotations/commands';
import { annotationAnchors, collectAnnotations } from '@/features/editor-md/annotations/model';
import { undoDepth } from '@tiptap/pm/history';
import { EditorView } from '@tiptap/pm/view';
import { nativeTestEditor } from './nativeTestEditor';
import { getEditingScope } from '@/features/editor-md/editingScope';

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
  nativeTestEditor(editor);
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

it('shows the shared reference count and states that deletion removes the whole explanation', async () => {
  const range = targetRange();
  await act(async () => editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.annotationReference.create({ id: 'example' }))));
  const before = editor.state.doc;
  await act(async () => anchor().click());
  expect(panel()?.querySelector('.nb-annotation-title')?.textContent).toBe('补充说明 · 2 处共用');
  const remove = panel()!.querySelector<HTMLButtonElement>('button[aria-label="删除说明及全部 2 处关联"]')!;
  expect(remove).not.toBeNull();
  await act(async () => remove.click());
  expect(panel()).toBeNull(); expect(annotationAnchors(editor.state.doc)).toEqual([]);
  expect(collectAnnotations(editor.state.doc).size).toBe(0);
  await act(async () => { editor.commands.undo(); }); expect(editor.state.doc.eq(before)).toBe(true);
});

it('retires reading popovers for a task transition without closing pins or unsaved drafts', async () => {
  const original = editor.state.doc;
  await act(async () => anchor().click());
  await act(async () => dismissTransientAnnotations(editor));
  expect(panel()).toBeNull();
  await act(async () => anchor().click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="固定说明"]')!.click());
  await act(async () => { editor.commands.setTextSelection(targetRange()); beginAnnotation(editor); });
  const draft = document.querySelector('[data-shortcuts-suspended="true"].nb-annotation-panel');
  expect(draft).not.toBeNull();
  await act(async () => dismissTransientAnnotations(editor));
  expect(document.querySelectorAll('.nb-annotation-panel')).toHaveLength(2);
  expect(document.querySelector('[data-shortcuts-suspended="true"].nb-annotation-panel')).toBe(draft);
  expect(document.querySelector('.nb-annotation-panel[data-pinned="true"]')).not.toBeNull();
  expect(editor.state.doc).toBe(original);
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

it('owns an external editing scope only while the annotation draft is active', async () => {
  await act(async () => { editor.commands.setTextSelection(targetRange()); beginAnnotation(editor); });
  expect(getEditingScope(editor.view)?.kind).toBe('external');
  expect(panel()?.querySelector('[role="toolbar"][aria-label="说明格式"]')).not.toBeNull();
  await act(async () => Array.from(panel()!.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === '取消')!.click());
  expect(getEditingScope(editor.view)).toBeNull();
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

it('saves with Enter before the embedded keymap and keeps Shift+Enter inside the draft', async () => {
  let id = '';
  await act(async () => { editor.commands.setTextSelection(targetRange()); id = beginAnnotation(editor)!; });
  const field = await enterBody('First line');
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  });
  expect(panel()?.querySelector('[data-annotation-edit]')).toBeNull();
  expect(field.querySelector('br')).not.toBeNull();
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(collectAnnotations(editor.state.doc).get(id)?.node.textContent).toBe('First line');
  expect(panel()?.querySelector('[data-annotation-edit]')).not.toBeNull();
  expect(undoDepth(editor.state)).toBe(1);
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button[aria-label="移除说明"]')!.click());
  expect(collectAnnotations(editor.state.doc).has(id)).toBe(false);
});

it('does not open a whole-block note when placing the caret in its paragraph', async () => {
  let block!: HTMLElement;
  await act(async () => {
    const from = targetRange().from - 1;
    editor.commands.setNodeSelection(from);
    addAnnotation(editor, [{ type: 'paragraph', content: [{ type: 'text', text: 'Block note' }] }], { open: false });
    const anchor = annotationAnchors(editor.state.doc).find(item => item.block)!;
    block = editor.view.nodeDOM(anchor.from) as HTMLElement;
    block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(panel()).toBeNull();
  await act(async () => block.querySelector<HTMLButtonElement>('.nb-annotation-indicator')!.click());
  expect(panel()?.textContent).toContain('Block note');
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
