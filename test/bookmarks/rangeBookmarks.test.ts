import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentBookmarks, bookmarkKey } from '@/features/bookmarks/extension';
import { addBookmark, removeBookmark, setBookmarkColor } from '@/features/bookmarks/commands';
import { captureBookmarkContexts, recoverBookmarks } from '@/features/bookmarks/model';
import { resetBookmarkStorage } from '@/features/bookmarks/storage';
import { navigateBookmark } from '@/features/bookmarks/navigation';
import { closeHistory } from '@tiptap/pm/history';

const editors: Editor[] = [];
const InlineMath = Node.create({ name:'mathInline', inline:true, group:'inline', atom:true, addAttributes:()=>({latex:{default:''}}), renderHTML:()=>['span',{'data-math-inline':''}] });
function create(html: string) { const editor = new Editor({ extensions: [StarterKit, InlineMath, DocumentBookmarks], content: html }); editors.push(editor); return editor; }
const records = (editor: Editor) => bookmarkKey.getState(editor.state)!;
beforeEach(() => { localStorage.clear(); resetBookmarkStorage(); });
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); resetBookmarkStorage(); vi.restoreAllMocks(); });

it('anchors an exact mid-paragraph range, treats only identical targets as duplicates, and preserves colors', () => {
  const editor = create(`<p>${'a'.repeat(5000)}TARGET${'b'.repeat(5000)}</p>`), before = editor.state.doc;
  editor.commands.setTextSelection({ from: 5001, to: 5007 });
  const first = addBookmark(editor)!;
  expect(first).toMatchObject({ kind: 'range', pos: 5001, size: 6, label: 'TARGET' });
  expect(addBookmark(editor)!.id).toBe(first.id); expect(records(editor)).toHaveLength(1);
  setBookmarkColor(editor, first.id, 'green');
  expect(editor.view.dom.querySelector('[data-bookmark-id]')?.getAttribute('style')).toContain('rgb(33, 134, 91)');
  editor.commands.setTextSelection({ from: 5002, to: 5005 }); addBookmark(editor);
  editor.commands.setTextSelection(5003); addBookmark(editor);
  expect(records(editor)).toHaveLength(3); expect(editor.state.doc).toBe(before); expect(editor.can().undo()).toBe(false);
  expect(records(editor)[0].color).toBe('green');
});

it('maps ranges through prefix typing, deletion, undo and source root synchronization', () => {
  const editor = create('<p>before TARGET after</p>');
  editor.commands.setTextSelection({ from: 8, to: 14 }); addBookmark(editor);
  editor.view.dispatch(closeHistory(editor.state.tr.insertText('new ', 1)));
  expect(records(editor)[0]).toMatchObject({ pos: 12, size: 6, quote: 'TARGET' });
  editor.view.dispatch(closeHistory(editor.state.tr.delete(12, 18)));
  expect(records(editor)[0].missing).toBe(true);
  editor.commands.undo(); expect(records(editor)[0]).toMatchObject({ pos: 12, size: 6, missing: false });
  const next = editor.schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'xnew before TARGET after' }] }] });
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta('noteboard-document-replacement', 'sync'));
  expect(records(editor)[0]).toMatchObject({ pos: 13, size: 6, missing: false });
});

it('keeps add, recolor and removal out of undo while undoing and redoing prose normally', () => {
  const editor = create('<p>original</p>');
  editor.view.dispatch(closeHistory(editor.state.tr.insertText(' edited', 9)));
  const record = addBookmark(editor)!; setBookmarkColor(editor, record.id, 'blue'); removeBookmark(editor, record.id);
  expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.textContent).toBe('original');
  expect(records(editor)).toHaveLength(0);
  expect(editor.commands.redo()).toBe(true); expect(editor.state.doc.textContent).toBe('original edited');
  expect(records(editor)).toHaveLength(0);
});

it('restores a range when undo recreates its whole paragraph and recovers it across marked text on reopen', () => {
  const editor = create('<p>before <strong>TARGET</strong> after</p><p>tail</p>');
  editor.commands.setTextSelection({ from: 8, to: 14 }); addBookmark(editor);
  const saved = captureBookmarkContexts(editor.state.doc, records(editor));
  expect(recoverBookmarks(editor.state.doc, saved)[0]).toMatchObject({ pos: 8, missing: false });
  editor.view.dispatch(closeHistory(editor.state.tr.delete(0, editor.state.doc.firstChild!.nodeSize)));
  expect(records(editor)[0].missing).toBe(true);
  editor.commands.undo(); expect(records(editor)[0]).toMatchObject({ pos: 8, size: 6, missing: false });
});

it('scrolls to the range line with a collapsed caret and transient highlight, not the paragraph start', () => {
  const editor = create('<p>before TARGET after</p>'); editor.commands.setTextSelection({ from: 8, to: 14 }); const record = addBookmark(editor)!;
  const scroller = document.createElement('div'); scroller.dataset.editorScroll = ''; document.body.append(scroller); scroller.append(editor.view.dom);
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 400 } as DOMRect);
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 10, top: 700, bottom: 724 });
  Object.defineProperties(scroller, { scrollHeight: { value: 1500 }, clientHeight: { value: 400 }, scrollTop: { value: 100, writable: true } });
  scroller.scrollTo = vi.fn();
  expect(navigateBookmark(editor, record)).toBe(true);
  expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 512, behavior: 'instant' });
  expect(editor.state.selection.empty).toBe(true); expect(editor.state.selection.from).toBe(8);
  expect(editor.view.dom.querySelector('.nb-bookmark-flash')?.textContent).toBe('TARGET');
  scroller.remove();
});

it('does not create meaningless bookmarks on empty text or metadata', () => {
  const editor = create('<p></p>'); expect(addBookmark(editor)).toBeNull(); expect(records(editor)).toHaveLength(0);
});

it('marks inline formulas as their own range and supports selecting all visible content', () => {
  const editor = create('<p>first</p><p>second</p>');
  editor.commands.selectAll(); const all = addBookmark(editor)!;
  expect(all.kind).toBe('range'); expect(all.size).toBe(editor.state.doc.content.size);
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'mathInline',attrs:{latex:'a^2'}}]}]});
  editor.commands.setNodeSelection(1); const formula = addBookmark(editor)!;
  expect(formula).toMatchObject({kind:'range',pos:1,size:1,label:'a^2'});
});
