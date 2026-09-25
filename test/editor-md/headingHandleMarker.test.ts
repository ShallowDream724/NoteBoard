import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import { HeadingFolding, toggleHeadingFold } from '@/features/editor-md/headingFolding';
import { markHeadingHandleTarget } from '@/features/editor-md/headingHandleMarker';

const editors: Editor[] = [];
const marker = '[data-nb-block-handle-active]';
function createEditor() {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({ element, extensions: [StarterKit, HeadingFolding], content: '<p>before</p><h1>Title</h1><p>body</p>' });
  editors.push(editor);
  return editor;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('heading handle widget marker', () => {
  it('keeps the same heading DOM after the observer runs, without dispatching or adding history', async () => {
    const editor = createEditor(), pos = editor.state.doc.firstChild!.nodeSize;
    const heading = editor.view.nodeDOM(pos) as HTMLElement;
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    const clear = markHeadingHandleTarget(editor, pos);
    expect(heading.firstElementChild?.matches(marker)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(editor.view.nodeDOM(pos)).toBe(heading);
    expect(heading.firstElementChild?.matches(marker)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(undoDepth(editor.state)).toBe(0);
    clear();
    expect(heading.querySelector(marker)).toBeNull();
  });

  it('restores the marker when folding rebuilds its widget and clears it on disposal', () => {
    const editor = createEditor(), pos = editor.state.doc.firstChild!.nodeSize;
    const clear = markHeadingHandleTarget(editor, pos);
    const oldWidget = editor.view.dom.querySelector(marker);
    toggleHeadingFold(editor.state, editor.view.dispatch, pos);
    const newWidget = editor.view.dom.querySelector(marker);
    expect(newWidget).not.toBeNull();
    expect(newWidget).not.toBe(oldWidget);
    expect(oldWidget?.hasAttribute('data-nb-block-handle-active')).toBe(false);
    editor.commands.setTextSelection(pos + 2);
    expect(editor.view.dom.querySelector(marker)).toBe(newWidget);
    expect(undoDepth(editor.state)).toBe(0);
    clear();
    expect(editor.view.dom.querySelector(marker)).toBeNull();
  });

  it('tracks a heading after preceding edits and removes the marker if the heading is deleted', () => {
    const editor = createEditor(), pos = editor.state.doc.firstChild!.nodeSize;
    const clear = markHeadingHandleTarget(editor, pos);
    editor.view.dispatch(editor.state.tr.insertText('new ', 1));
    const moved = editor.view.nodeDOM(pos + 4) as HTMLElement;
    expect(moved.querySelector(marker)).not.toBeNull();
    editor.view.dispatch(editor.state.tr.delete(pos + 4, pos + 4 + editor.state.doc.nodeAt(pos + 4)!.nodeSize));
    expect(editor.view.dom.querySelector(marker)).toBeNull();
    clear();
  });
});
