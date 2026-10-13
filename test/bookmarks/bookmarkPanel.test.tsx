import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BookmarkPanel } from '@/features/bookmarks/BookmarkPanel';
import { bookmarkKey, DocumentBookmarks } from '@/features/bookmarks/extension';
import { addBookmark } from '@/features/bookmarks/commands';
import { resetBookmarkStorage } from '@/features/bookmarks/storage';
import { BookmarkPreview, bookmarkPreviewParts } from '@/features/bookmarks/BookmarkPreview';
import { MathBlockNode, MathInlineNode } from '@/features/editor-md/documentNodes';
import { renderMath } from '@/features/editor-md/mathRendering';
import type { DocumentBookmark } from '@/features/bookmarks/types';
import { BookmarkMarkerLayer } from '@/features/bookmarks/BookmarkMarkerLayer';
import { useLayoutStore } from '@/stores/layoutStore';

vi.mock('@/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/features/editor-md/mathRendering', () => ({ renderMath: vi.fn(async () => ({ html: '<span class="katex">x²</span>' })) }));
let editor: Editor, root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  localStorage.clear(); resetBookmarkStorage();
  host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
  editor = new Editor({ extensions: [StarterKit, MathBlockNode, MathInlineNode, DocumentBookmarks.configure({ docKey: 'test-bookmarks-ui' })],
    content: '<p>First paragraph</p><p>Second paragraph</p>' });
});
afterEach(async () => {
  await act(async () => root.unmount()); editor.destroy(); resetBookmarkStorage(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!; }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
async function context(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 40 })); }); }
function records() { return bookmarkKey.getState(editor.state)!; }

test('adds exact selections idempotently with feedback and no permanent delete buttons', async () => {
  editor.commands.setTextSelection({ from: 7, to: 16 });
  await act(async () => root.render(<BookmarkPanel editor={editor}/>));
  await click(button('添加书签'));
  expect(records()).toHaveLength(1); expect(host.querySelector('.nb-bookmark-message')).toBeNull();
  expect(host.querySelector('.nb-bookmark-remove')).toBeNull();
  await click(button('添加书签'));
  expect(records()).toHaveLength(1); expect(host.querySelector('.nb-bookmark-message')).toBeNull();
  expect(host.querySelector('.nb-bookmark-preview')?.textContent).toBe('paragraph');
});

test('document markers reveal the matching panel entry without moving the selection, and expose removal', async () => {
  editor.commands.setTextSelection({ from: 7, to: 16 }); const record = addBookmark(editor)!;
  document.body.append(editor.view.dom);
  useLayoutStore.setState({ navigationTab: 'outline', outlineVisible: false });
  await act(async () => root.render(<BookmarkMarkerLayer editor={editor}/>));
  const selection = editor.state.selection.toJSON(), doc = editor.state.doc;
  const marker = editor.view.dom.querySelector<HTMLButtonElement>('.nb-bookmark-button')!;
  await click(marker);
  expect(useLayoutStore.getState()).toMatchObject({ navigationTab: 'bookmarks', outlineVisible: true });
  await act(async () => root.render(<><BookmarkMarkerLayer editor={editor}/><BookmarkPanel editor={editor}/></>));
  expect(host.querySelector('[data-revealed]')?.getAttribute('data-bookmark-id')).toBe(record.id);
  expect(document.activeElement).toBe(host.querySelector('.nb-bookmark-target'));
  expect(editor.state.selection.toJSON()).toEqual(selection); expect(editor.state.doc).toBe(doc);
  await context(marker); expect(button('删除书签')).toBeDefined(); expect(button('批量删除')).toBeUndefined();
  await click(button('删除书签'));
  expect(records()).toHaveLength(0); expect(editor.can().undo()).toBe(false);
  expect(editor.state.doc).toBe(doc); expect(document.querySelector('.nb-bookmark-menu')).toBeNull();
});

test('block markers support the same keyboard context menu and close when the target is removed', async () => {
  editor.commands.setContent({type:'doc',content:[{type:'mathBlock',attrs:{latex:'E=mc^2'}}]}, {emitUpdate:false});
  addBookmark(editor, 0); document.body.append(editor.view.dom);
  await act(async () => root.render(<BookmarkMarkerLayer editor={editor}/>));
  const marker = editor.view.dom.querySelector('.nb-bookmark-block-marker .nb-bookmark-button')!;
  await act(async () => { marker.dispatchEvent(new KeyboardEvent('keydown', {key:'F10',shiftKey:true,bubbles:true,cancelable:true})); });
  expect(button('删除书签')).toBeDefined();
  await click(button('删除书签')); expect(records()).toHaveLength(0);
  expect(editor.view.dom.querySelector('.nb-bookmark-button')).toBeNull();
});

test('context menu supports temporary batch deletion, blank click and Escape end it without consuming input', async () => {
  editor.commands.setTextSelection(19); addBookmark(editor); editor.commands.setTextSelection(2); addBookmark(editor);
  await act(async () => root.render(<BookmarkPanel editor={editor}/>));
  expect([...host.querySelectorAll('.nb-bookmark-target')].map(item => item.textContent)).toEqual(['First paragraph', 'Second paragraph']);
  await context(host.querySelector('.nb-bookmark-item')!); await click(button('批量删除'));
  expect(host.querySelectorAll('.nb-bookmark-remove')).toHaveLength(2);
  await click(host.querySelector('.nb-bookmark-remove')!);
  expect(records()).toHaveLength(1); expect(host.querySelectorAll('.nb-bookmark-remove')).toHaveLength(1);
  const blank = new Event('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => { host.dispatchEvent(blank); });
  expect(blank.defaultPrevented).toBe(false); expect(host.querySelector('.nb-bookmark-remove')).toBeNull();
  await context(host.querySelector('.nb-bookmark-item')!); await click(button('批量删除'));
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(host.querySelector('.nb-bookmark-remove')).toBeNull();
});

test('color menu changes metadata, keyboard context menu deletes and outside clicks dismiss', async () => {
  addBookmark(editor);
  await act(async () => root.render(<BookmarkPanel editor={editor}/>));
  await click(host.querySelector('.nb-bookmark-color')!); await click(button('绿色'));
  expect(records()[0].color).toBe('green'); expect(document.querySelector('.nb-bookmark-menu')).toBeNull();
  await act(async () => { host.querySelector('.nb-bookmark-target')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })); });
  expect(button('跳转到书签')).toBeDefined();
  await act(async () => { host.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
  expect(document.querySelector('.nb-bookmark-menu')).toBeNull();
  await context(host.querySelector('.nb-bookmark-item')!); await click(button('删除书签'));
  expect(records()).toHaveLength(0); expect(host.textContent).toContain('暂无书签');
});

test('preview preserves semantic inline formatting and bounded formulas without copying the selected document', async () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
    { type: 'text', text: 'code', marks: [{ type: 'code' }] }, { type: 'mathInline', attrs: { latex: 'x^2' } },
    { type: 'text', text: 'word'.repeat(25000) },
  ] }] });
  const record: DocumentBookmark = { id: 'preview', pos: 1, size: editor.state.doc.content.size - 2, nodeType: 'range', kind: 'range', quote: '', label: 'Selected', missing: false };
  const parts = bookmarkPreviewParts(editor.state.doc, record);
  expect(parts).toHaveLength(5); expect(parts.reduce((sum, part) => sum + part.text.length, 0)).toBeLessThanOrEqual(160);
  await act(async () => root.render(<BookmarkPreview doc={editor.state.doc} record={record}/>));
  expect(host.querySelector('strong')?.textContent).toBe('bold'); expect(host.querySelector('em')?.textContent).toBe('italic');
  expect(host.querySelector('code')?.textContent).toBe('code'); expect(host.querySelector('.katex')?.textContent).toBe('x²');
  expect(renderMath).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<BookmarkPreview doc={editor.state.doc} record={{ ...record, color: 'blue' }}/>));
  expect(renderMath).toHaveBeenCalledTimes(1);
});

test('offscreen formula rendering is deferred and its outstanding subscription is cancelled on unmount', async () => {
  let callback: IntersectionObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(value: IntersectionObserverCallback) { callback = value; } observe() {} unobserve() {} disconnect = disconnect; });
  editor.commands.setContent({ type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'E=mc^2' } }] });
  const record: DocumentBookmark = { id: 'math', pos: 0, size: 1, nodeType: 'mathBlock', quote: '', label: 'Formula', missing: false };
  await act(async () => root.render(<BookmarkPreview doc={editor.state.doc} record={record}/>));
  expect(renderMath).not.toHaveBeenCalled();
  const target = host.querySelector('.nb-bookmark-math')!;
  await act(async () => callback!([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(renderMath).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(renderMath).mock.calls[0][2]?.signal;
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true); expect(disconnect).toHaveBeenCalledOnce();
});
