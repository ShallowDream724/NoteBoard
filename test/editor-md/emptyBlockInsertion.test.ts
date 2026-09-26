import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';

const mock = vi.hoisted(() => ({ editor: null as unknown as Editor, capabilities: {}, key: 'untitled:empty-block', active: true }));
vi.mock('../../src/features/editor-md/editorDocumentCodec', () => ({ editorDocumentKey: () => mock.key }));
vi.mock('../../src/features/document-format/featureGate', () => ({ runWithDocumentCapability: (editor: Editor, _capability: string, action: (editor: Editor) => boolean) => action(editor) }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: {
  getState: () => ({ getDocument: () => ({ key: mock.key, dirPath: null }) }), subscribe: () => () => {},
} }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: {
  getState: () => ({ activeKey: mock.active ? mock.key : 'other', tabs: [{ key: mock.key, viewMode: 'visual' }], pendingCloseKeys: [], isWindowClosing: false, isTransferring: () => false }), subscribe: () => () => {},
} }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ getEditorCapabilities: () => mock.capabilities }));
vi.mock('../../src/features/session/documentSession', () => ({ getSessionGeneration: () => 1, isClosing: () => false }));
vi.mock('../../src/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => mock.editor }));
import { captureEmptyParagraphInsertion, replaceEmptyParagraph } from '../../src/features/editor-md/emptyBlockInsertion';
import { Disclosure } from '../../src/features/editor-md/rich-content/schema';

beforeEach(() => {
  mock.active = true;
  mock.editor = new Editor({ extensions: [StarterKit, Image, Disclosure], content: '<p>before</p><p></p><p>after</p>', editorProps: { handleScrollToSelection: () => true } });
});
afterEach(() => { mock.editor.destroy(); });
const target = () => mock.editor.state.doc.firstChild!.nodeSize;
const captureImage = () => captureEmptyParagraphInsertion<string>(mock.editor, target(), src => ({ type: 'image', attrs: { src } }))!;

describe('empty paragraph insertion', () => {
  it('replaces only the named empty paragraph despite a different selected node and undoes in one step', () => {
    const before = mock.editor.state.doc.toJSON();
    mock.editor.view.dispatch(mock.editor.state.tr.setSelection(NodeSelection.create(mock.editor.state.doc, 0)));
    expect(replaceEmptyParagraph(mock.editor, target(), { type: 'heading', attrs: { level: 3 } })).toBe(true);
    expect(mock.editor.state.doc.childCount).toBe(3);
    expect(mock.editor.state.doc.child(0).textContent).toBe('before');
    expect(mock.editor.state.doc.child(1).type.name).toBe('heading');
    expect(mock.editor.state.doc.child(1).attrs.level).toBe(3);
    expect(mock.editor.commands.undo()).toBe(true);
    expect(mock.editor.state.doc.toJSON()).toEqual(before);
  });
  it('rejects a paragraph containing an inline atom even when its text is empty', () => {
    mock.editor.commands.setContent('<p><br></p>');
    expect(replaceEmptyParagraph(mock.editor, 0, { type: 'heading', attrs: { level: 1 } })).toBe(false);
  });
  it('maps a pending image to the original empty paragraph without an extra blank line', () => {
    mock.editor.commands.setTextSelection(2);
    const selection = mock.editor.state.selection;
    const lease = captureImage();
    expect(mock.editor.state.selection).toBe(selection);
    mock.editor.view.dispatch(mock.editor.state.tr.insertText('prefix ', 1));
    mock.editor.commands.setTextSelection(1);
    expect(lease.commit('image.png')).toBe(true);
    expect(mock.editor.state.doc.childCount).toBe(3);
    expect(mock.editor.state.doc.child(0).textContent).toBe('prefix before');
    expect(mock.editor.state.doc.child(1).type.name).toBe('image');
    expect(mock.editor.state.doc.child(2).textContent).toBe('after');
  });
  it('inserts a link at the captured paragraph without requesting selection scrolling', () => {
    const scroll = vi.fn(() => true);
    mock.editor.setOptions({ editorProps: { handleScrollToSelection: scroll } });
    const lease = captureEmptyParagraphInsertion(mock.editor, target(), (text: string) => ({
      type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }],
    }))!;
    expect(lease.commit('link')).toBe(true);
    expect(mock.editor.state.doc.child(1).textContent).toBe('link');
    expect(mock.editor.state.selection.$from.parent.textContent).toBe('link');
    expect(scroll).not.toHaveBeenCalled();
  });
  it('does not replace content typed into the paragraph while the dialog is open', () => {
    const lease = captureImage();
    mock.editor.view.dispatch(mock.editor.state.tr.insertText('keep', target() + 1));
    expect(lease.commit('image.png')).toBe(false);
    expect(mock.editor.state.doc.child(1).textContent).toBe('keep');
  });
  it('cancels a pending result when its target is deleted or the document is no longer active', () => {
    const deleted = captureImage(), pos = target();
    mock.editor.view.dispatch(mock.editor.state.tr.delete(pos, pos + 2));
    expect(deleted.current()).toBe(false); expect(deleted.commit('image.png')).toBe(false); deleted.dispose();
    mock.editor.commands.setContent('<p>before</p><p></p><p>after</p>');
    const inactive = captureImage(); mock.active = false;
    expect(inactive.commit('image.png')).toBe(false); inactive.dispose();
    expect(mock.editor.state.doc.child(1).type.name).toBe('paragraph');
  });
  it('keeps image insertion and the trailing editable paragraph inside a disclosure in one undo step', () => {
    mock.editor.commands.setContent({ type: 'doc', content: [{ type: 'disclosure', content: [{ type: 'paragraph' }] }] });
    const before = mock.editor.state.doc.toJSON();
    expect(replaceEmptyParagraph(mock.editor, 1, { type: 'image', attrs: { src: 'image.png' } })).toBe(true);
    expect(mock.editor.state.doc.firstChild?.child(0).type.name).toBe('image');
    expect(mock.editor.state.doc.firstChild?.child(1).type.name).toBe('paragraph');
    expect(mock.editor.state.selection.$from.node(1).type.name).toBe('disclosure');
    expect(mock.editor.commands.undo()).toBe(true); expect(mock.editor.state.doc.toJSON()).toEqual(before);
  });
});
