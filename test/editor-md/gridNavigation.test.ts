import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { ImageNode } from '@/features/editor-md/documentNodes';
import { InteractiveDisclosure, InteractiveImageCollection, InteractiveImageSlot } from '@/features/editor-md/rich-content/views';
import { MediaEditing, handleMediaKey } from '@/features/editor-md/mediaEditing';

const editors: Editor[] = [];
const paragraph = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const image = (name: string): JSONContent => ({ type: 'image', attrs: { src: `${name}.png` } });
const slot = (name: string, caption?: string): JSONContent => ({ type: 'imageSlot', content: [image(name), ...(caption === undefined ? [] : [paragraph(caption)])] });
function create(slots: JSONContent[], columns = 2, surround = true, nested = false) {
  const grid: JSONContent = { type: 'imageCollection', attrs: { columns }, content: slots };
  const blocks = surround ? [paragraph('before'), grid, paragraph('after')] : [grid];
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: false }), ImageNode, InteractiveImageCollection, InteractiveImageSlot, InteractiveDisclosure, MediaEditing],
    editorProps: { handleScrollToSelection: () => true }, content: { type: 'doc', content: nested ? [{ type: 'disclosure', content: blocks }] : blocks } });
  editors.push(editor); document.body.append(editor.view.dom);
  // JSDOM has no line geometry; these fixture captions occupy one visual line.
  vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
  const positions: number[] = []; let gridPos = -1;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'imageCollection') gridPos = pos; if (node.type.name === 'imageSlot') positions.push(pos); });
  const selectImage = (index: number) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, positions[index] + 1)));
  const selectedImage = () => editor.state.selection instanceof NodeSelection ? editor.state.selection.node.attrs.src : undefined;
  const key = (key: string, target: EventTarget = editor.view.dom) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); target.dispatchEvent(event); return event;
  };
  return { editor, positions, gridPos, selectImage, selectedImage, key };
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('image grid visual keyboard navigation', () => {
  it('uses row-major image stops horizontally, skipping every caption and crossing rows', () => {
    const { editor, selectImage, selectedImage, key } = create(['A', 'B', 'C', 'D'].map(name => slot(name, name)), 2);
    const before = editor.state.doc;
    selectImage(0);
    for (const name of ['B', 'C', 'D']) { key('ArrowRight'); expect(selectedImage()).toBe(`${name}.png`); }
    key('ArrowRight'); expect(editor.state.selection.$from.parent.textContent).toBe('after');
    selectImage(3);
    for (const name of ['C', 'B', 'A']) { key('ArrowLeft'); expect(selectedImage()).toBe(`${name}.png`); }
    key('ArrowLeft'); expect(editor.state.selection.$from.parent.textContent).toBe('before');
    expect(editor.state.doc).toBe(before);
  });
  it.each([1, 2, 3])('visits image, own caption, then the next image in the same column (%i columns)', columns => {
    const { editor, selectImage, selectedImage, key } = create(['A', 'B', 'C', 'D', 'E', 'F'].map(name => slot(name, name)), columns);
    const before = editor.state.doc;
    selectImage(0); key('ArrowDown'); expect(editor.state.selection.$from.parent.textContent).toBe('A');
    key('ArrowDown'); expect(selectedImage()).toBe(`${'ABCDEF'[columns]}.png`);
    key('ArrowUp'); expect(editor.state.selection.$from.parent.textContent).toBe('A');
    key('ArrowUp'); expect(selectedImage()).toBe('A.png');
    expect(editor.state.doc).toBe(before);
  });
  it('keeps editing caption text until the visual edge, and preserves selection extension and IME keys', () => {
    const { editor, positions, selectImage, selectedImage, key } = create([slot('A', 'long caption'), slot('B', 'second')]);
    const captionStart = positions[0] + 3;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, captionStart + 4)));
    vi.mocked(editor.view.endOfTextblock).mockReturnValue(false);
    for (const pressed of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(handleMediaKey(editor.view, new KeyboardEvent('keydown', { key: pressed }))).toBe(false);
      expect(editor.state.selection.from).toBe(captionStart + 4);
    }
    vi.mocked(editor.view.endOfTextblock).mockReturnValue(true);
    key('ArrowUp'); expect(selectedImage()).toBe('A.png');
    selectImage(0);
    for (const options of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      expect(handleMediaKey(editor.view, new KeyboardEvent('keydown', { key: 'ArrowRight', ...options }))).toBe(false);
      expect(selectedImage()).toBe('A.png');
    }
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, captionStart, captionStart + 3)));
    expect(handleMediaKey(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
  });
  it('uses add-caption and empty-slot controls without creating document content', () => {
    const { editor, selectImage, selectedImage, key } = create([slot('A'), { type: 'imageSlot' }, slot('C', 'caption')], 1);
    const before = editor.state.doc;
    selectImage(0); key('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('添加图注');
    key('ArrowDown', document.activeElement!);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('添加图片');
    key('ArrowDown', document.activeElement!); expect(selectedImage()).toBe('C.png');
    key('ArrowUp'); expect(document.activeElement?.getAttribute('aria-label')).toBe('添加图片');
    key('ArrowUp', document.activeElement!); expect(document.activeElement?.getAttribute('aria-label')).toBe('添加图注');
    key('ArrowUp', document.activeElement!); expect(selectedImage()).toBe('A.png');
    expect(editor.state.doc).toBe(before);
    key('ArrowDown'); (document.activeElement as HTMLButtonElement).click();
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.$from.parent.textContent).toBe('');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('enters the first/last image from a whole-grid selection but keeps whole-grid vertical navigation', () => {
    const { editor, gridPos, selectedImage, key } = create([slot('A'), slot('B')]);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, gridPos)));
    key('ArrowRight'); expect(selectedImage()).toBe('A.png');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, gridPos)));
    key('ArrowLeft'); expect(selectedImage()).toBe('B.png');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, gridPos)));
    key('ArrowDown'); expect(editor.state.selection.$from.parent.textContent).toBe('after');
  });
  it.each([false, true])('does not add paragraphs at first/last grid boundaries, including nested containers (%s)', nested => {
    const { editor, gridPos, selectImage, selectedImage, key } = create([slot('A', ''), slot('B', '')], 1, false, nested);
    const before = editor.state.doc;
    selectImage(0); key('ArrowLeft'); key('ArrowUp'); expect(selectedImage()).toBe('A.png');
    selectImage(1); key('ArrowRight'); expect(selectedImage()).toBe('B.png');
    key('ArrowDown'); key('ArrowDown'); expect(editor.state.selection).toBeInstanceOf(TextSelection);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, gridPos)));
    key('ArrowUp'); key('ArrowDown');
    expect(editor.state.selection.from).toBe(gridPos);
    expect(editor.state.doc).toBe(before);
  });
  it('does not diagonally wrap a short final row when moving down from its missing column', () => {
    const { editor, selectImage, key } = create([slot('A', 'A'), slot('B', 'B'), slot('C', 'C')], 2);
    selectImage(1); key('ArrowDown'); key('ArrowDown');
    expect(editor.state.selection.$from.parent.textContent).toBe('after');
  });
});
