import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { revealEditorBlock } from '../../src/features/editor-md/editorViewport';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); document.body.replaceChildren(); });
function fixture(top: number, height = 30, table = false) {
  const outer = document.createElement('div'), owner = document.createElement('div');
  owner.dataset.editorScroll = 'markdown'; outer.append(owner); document.body.append(outer);
  editor = new Editor({ element: owner, extensions: [StarterKit, Table, TableCell, TableHeader, TableRow],
    content: table ? '<table><tr><td>Target</td></tr></table>' : '<h1>Target</h1><p>Text</p>' });
  editor.view.dom.style.lineHeight = '28px';
  outer.scrollTop = 37; owner.scrollTop = 700;
  vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 600, 500));
  vi.spyOn(editor.view.nodeDOM(0) as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 500, height));
  const scroll = vi.fn(); owner.scrollTo = scroll;
  return { outer, owner, scroll, view: editor.view };
}
it('leaves an inserted paragraph already in view in place', () => {
  const { scroll, view } = fixture(500);
  revealEditorBlock(view, 0);
  expect(scroll).not.toHaveBeenCalled();
});
it('reveals only a tall inserted block leading edge on the declared owner', () => {
  const { scroll, view, outer } = fixture(700, 1500);
  revealEditorBlock(view, 0);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 1260, behavior: 'instant' });
  expect(outer.scrollTop).toBe(37);
});
it('aligns explicit heading navigation in a single immediate scroll', () => {
  const { owner, scroll, view } = fixture(5000);
  expect(revealEditorBlock(view, 0, 'start')).toBe(owner);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 5560, behavior: 'instant' });
});
it('keeps a short inserted table and four lines below its final row visible', () => {
  const { scroll, view } = fixture(500, 100, true);
  revealEditorBlock(view, 0);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 812, behavior: 'instant' });
});
it('aligns a tall table to its leading edge even when its first row was barely visible', () => {
  const { scroll, view } = fixture(500, 1500, true);
  revealEditorBlock(view, 0);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 1060, behavior: 'instant' });
});
