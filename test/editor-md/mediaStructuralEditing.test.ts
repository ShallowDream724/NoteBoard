import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { MediaEditing } from '@/features/editor-md/mediaEditing';
import { createAnnotationBodyView } from '@/features/editor-md/annotations/bodyView';
import { AnnotationBehavior } from '@/features/editor-md/annotations/extension';
import { ClipboardImport, DOCUMENT_SLICE_MIME, importClipboardSnapshot, writeDocumentClipboard } from '@/features/editor-md/clipboard/clipboardImport';
import { insertViewImages } from '@/features/editor-md/imageInsertionLease';
import { imageRemovalTransaction, requestImageRemoval } from '@/features/editor-md/imageRemoval';
import { normalizeImageSlots } from '@/features/editor-md/imageCaptions';

const removal = vi.hoisted(() => ({ choice: vi.fn<() => Promise<'keep' | 'remove' | null>>(async () => 'remove') }));
vi.mock('@/features/editor-md/imageCaptionRemoval', () => ({ resolveImageCaptionRemoval: removal.choice }));
const editors: Editor[] = [], drafts: EditorView[] = [];
const paragraph = (text = ''): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const image = (caption?: string): JSONContent => ({ type: 'image', attrs: { src: 'one.png', ...(caption ? { caption, captionContent: [{ type: 'text', text: caption, marks: [{ type: 'bold' }] }] } : {}) } });
const collection = (layout = 'grid', content: JSONContent[] = []): JSONContent => ({ type: 'imageCollection', attrs: { layout }, content: [{ type: 'imageSlot', content }] });
function create(content: JSONContent[], draft = false) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), MediaEditing, AnnotationBehavior, ClipboardImport], content: { type: 'doc', content }, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); document.body.append(editor.view.dom);
  if (!draft) return editor.view;
  const host = document.createElement('div'); document.body.append(host);
  const body = editor.schema.nodes.annotationBody.create({ id: 'draft' }, content.map(node => editor.schema.nodeFromJSON(node)));
  const view = createAnnotationBodyView(host, editor, body, true); view.setProps({ handleScrollToSelection: () => true }); drafts.push(view); return view;
}
function key(view: EditorView, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  view.dom.dispatchEvent(event); return event;
}
afterEach(() => {
  drafts.splice(0).forEach(view => view.destroy()); editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren(); removal.choice.mockReset().mockResolvedValue('remove');
});

describe.each([false, true])('media structure in %s (true = annotation draft)', draft => {
  it('replaces the empty line with block images and places the caret on the following line', () => {
    const view = create([paragraph('before'), paragraph(), paragraph('after')], draft);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));
    insertViewImages(view, [{ src: 'one.png', alt: '' }, { src: 'two.png', alt: '' }], view.state.selection);
    expect(view.state.doc.content.toJSON().map((node: JSONContent) => node.type)).toEqual(['paragraph', 'image', 'image', 'paragraph']);
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    expect(view.state.selection.$from.parent.textContent).toBe('after');
    expect(view.state.selection.$from.parentOffset).toBe(0);
  });
  it('pastes an internally copied image on the empty first line with a trailing writable paragraph', () => {
    const view = create([paragraph()], draft);
    const payload = JSON.stringify({ version: 1, openStart: 0, openEnd: 0, content: [image('caption')] });
    expect(importClipboardSnapshot(view, { formats: { [DOCUMENT_SLICE_MIME]: payload } })).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('image');
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(view.state.selection.from).toBe(2);
  });
  it('keeps mixed HTML text and images in separate blocks', () => {
    const view = create([paragraph()], draft);
    importClipboardSnapshot(view, { formats: { 'text/html': '<p>above<img src="one.png">below</p>' } });
    expect(view.state.doc.content.toJSON().map((node: JSONContent) => node.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(view.state.doc.child(0).textContent).toBe('above');
    expect(view.state.doc.child(2).textContent).toBe('below');
  });
  it('visibly selects an image between text and reaches the next paragraph, then mirrors ArrowUp', () => {
    const view = create([paragraph('a'), image(), paragraph('b')], draft);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    key(view, 'ArrowDown'); expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect((view.state.selection as NodeSelection).node.type.name).toBe('image');
    key(view, 'ArrowDown'); expect(view.state.selection.from).toBe(5);
    key(view, 'ArrowUp'); expect(view.state.selection).toBeInstanceOf(NodeSelection);
    key(view, 'ArrowUp'); expect(view.state.selection.from).toBe(2);
  });
  it.each(['grid', 'carousel'])('treats the %s collection as one visible vertical selection', layout => {
    const view = create([paragraph('a'), collection(layout, [image(), paragraph('caption')]), paragraph('b')], draft);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    key(view, 'ArrowDown'); expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect((view.state.selection as NodeSelection).node.type.name).toBe('imageCollection');
    key(view, 'ArrowDown'); expect(view.state.selection.$from.parent.textContent).toBe('b');
    key(view, 'ArrowUp'); expect((view.state.selection as NodeSelection).node.type.name).toBe('imageCollection');
  });
  it.each(['Enter', 'ArrowDown'])('continues below a terminal selected image with %s without deleting it', pressed => {
    const view = create([image()], draft);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    key(view, pressed);
    expect(view.state.doc.firstChild?.type.name).toBe('image');
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    key(view, 'Enter'); expect(view.state.doc.firstChild?.type.name).toBe('image');
  });
  it('Enter in the paragraph above an image keeps the image intact', () => {
    const view = create([paragraph(), image()], draft);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    key(view, 'Enter');
    expect(view.state.doc.content.toJSON().filter((node: JSONContent) => node.type === 'image')).toHaveLength(1);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
  });
});

describe('canonical slot captions and explicit image removal', () => {
  it.each(['grid', 'carousel'])('pastes formatted attribute and HTML captions into one %s slot paragraph', layout => {
    for (const format of ['internal', 'html']) {
      const view = create([collection(layout, [paragraph()])]);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
      const formats: Record<string, string> = format === 'internal'
        ? { [DOCUMENT_SLICE_MIME]: JSON.stringify({ version: 1, openStart: 0, openEnd: 0, content: [image('A caption')] }) }
        : { 'text/html': '<figure data-nb-image><img src="one.png"><figcaption><strong>A caption</strong></figcaption></figure>' };
      importClipboardSnapshot(view, { formats });
      const slot = view.state.doc.firstChild!.firstChild!;
      expect(slot.childCount, format + JSON.stringify(view.state.doc.toJSON())).toBe(2); expect(slot.lastChild?.type.name).toBe('paragraph');
      expect(slot.lastChild?.textContent).toBe('A caption'); expect(slot.lastChild?.firstChild?.marks[0].type.name).toBe('bold');
      expect(slot.firstChild?.attrs.caption).toBeNull(); expect(slot.firstChild?.attrs.captionContent).toBeNull();
    }
  });
  it('normalizes a legacy duplicate caption once and preserves the richer formatting', () => {
    const view = create([collection('grid', [image('same'), paragraph('same')])]);
    const normalized = normalizeImageSlots(view.state.doc), slot = normalized.firstChild!.firstChild!;
    expect(slot.childCount).toBe(2); expect(slot.textContent).toBe('same');
    expect(slot.lastChild?.firstChild?.marks[0].type.name).toBe('bold');
    expect(normalizeImageSlots(normalized)).toBe(normalized);
  });
  it('copies a slot image together with its rich caption', () => {
    const view = create([collection('grid', [image(), { type: 'paragraph', content: [{ type: 'text', text: 'rich', marks: [{ type: 'italic' }] }] }])]);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2)));
    const values: Record<string, string> = {};
    writeDocumentClipboard(view, { clipboardData: { setData: (type: string, value: string) => { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent, false);
    const copied = JSON.parse(values[DOCUMENT_SLICE_MIME]).content[0];
    expect(copied.attrs.caption).toBe('rich'); expect(copied.attrs.captionContent[0].marks[0].type).toBe('italic');
  });
  it('cuts a slot image and caption together without consulting deletion preference', () => {
    const view = create([collection('grid', [image(), paragraph('caption')])]);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2)));
    const values: Record<string, string> = {};
    writeDocumentClipboard(view, { clipboardData: { setData: (type: string, value: string) => { values[type] = value; } }, preventDefault() {} } as unknown as ClipboardEvent, true);
    expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(0);
    expect(JSON.parse(values[DOCUMENT_SLICE_MIME]).content[0].attrs.caption).toBe('caption');
    expect(removal.choice).not.toHaveBeenCalled();
  });
  it.each(['keep', 'remove'] as const)('applies %s to the slot paragraph and image as one transaction', choice => {
    const view = create([collection('grid', [image(), paragraph('caption')])]);
    const tr = imageRemovalTransaction(view.state, 2, choice)!; view.dispatch(tr);
    const slot = view.state.doc.firstChild!.firstChild!;
    expect(slot.childCount).toBe(choice === 'keep' ? 1 : 0);
    if (choice === 'keep') expect(slot.firstChild?.textContent).toBe('caption');
  });
  it('keeps a standalone formatted caption and its attached explanation reachable', async () => {
    const picture = image('caption'); picture.attrs!.annotationId = 'attached';
    const view = create([picture, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'attached' }, content: [paragraph('explanation')] }] }]);
    removal.choice.mockResolvedValue('keep');
    expect(await requestImageRemoval(view, 0)).toBe(true);
    expect(view.state.doc.firstChild?.attrs.annotationId).toBe('attached');
    expect(view.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe('bold');
    expect(view.state.doc.content.toJSON().some((node: JSONContent) => node.type === 'annotationStore')).toBe(true);
  });
  it('cancels without changing the image or caption and applies the same choice from Delete', async () => {
    const view = create([collection('grid', [image(), paragraph('caption')])]), before = view.state.doc;
    removal.choice.mockResolvedValue(null);
    expect(await requestImageRemoval(view, 2)).toBe(false); expect(view.state.doc).toBe(before);
    removal.choice.mockResolvedValue('remove');
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2))); key(view, 'Delete');
    await vi.waitFor(() => expect(view.state.doc.firstChild?.firstChild?.childCount).toBe(0));
    expect(removal.choice).toHaveBeenLastCalledWith(expect.objectContaining({ hasCaption: true }));
  });
});
