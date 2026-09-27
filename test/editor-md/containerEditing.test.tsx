import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { GitHubAlert } from '../../src/features/editor-md/alertExtension';
import { InteractiveDisclosure } from '../../src/features/editor-md/rich-content/views';
import { insertViewImages } from '../../src/features/editor-md/imageInsertionLease';
import { insertImportedSlice } from '../../src/features/editor-md/clipboard/clipboardImport';

const editors: Editor[] = [], roots: Root[] = [];
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterAll(() => vi.unstubAllGlobals());
const p = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const container = (type: string, ...content: JSONContent[]): JSONContent => ({ type, content });
const image: JSONContent = { type: 'image', attrs: { src: 'one.png' } };
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: buildDocumentExtensions({ githubAlert: GitHubAlert, disclosure: InteractiveDisclosure }), content: { type: 'doc', content } });
  editors.push(editor); return editor;
}
afterEach(async () => { await act(async () => roots.splice(0).forEach(root => root.unmount())); editors.splice(0).forEach(editor => editor.destroy()); });
describe('shared container continuation', () => {
  it.each(['githubAlert', 'disclosure', 'blockquote'])('%s keeps image paste and continuation inside, as one undo step', type => {
    const editor = create([container(type, p()), p('outside')]), before = editor.state.doc;
    insertViewImages(editor.view, [{ src: 'one.png', alt: '' }, { src: 'two.png', alt: '' }], TextSelection.create(before, 2));
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.node(1).type.name).toBe(type);
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    editor.commands.insertContent('continue'); expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe('continue');
    editor.commands.undo(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it.each([['githubAlert', 'disclosure'], ['disclosure', 'githubAlert']])('HTML image paste in %s > %s appends only to the inner container', (outer, inner) => {
    const editor = create([container(outer, container(inner, p())), p('outside')]), before = editor.state.doc;
    insertImportedSlice(editor.view, { slice: new Slice(Fragment.from(editor.schema.nodeFromJSON(image)), 0, 0), bodies: [], diagnostics: [] }, TextSelection.create(before, 3));
    expect(editor.state.selection.$from.node(2).type.name).toBe(inner);
    expect(editor.state.doc.firstChild!.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.firstChild!.lastChild!.type.name).toBe('paragraph');
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('does not duplicate an existing paragraph after the insertion', () => {
    const editor = create([container('githubAlert', p(), p('existing')), p('outside')]);
    insertViewImages(editor.view, [{ src: 'one.png', alt: '' }], TextSelection.create(editor.state.doc, 2));
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe('existing');
  });
  it('existing Note images offer click and keyboard continuation via the React view', async () => {
    const editor = create([container('githubAlert', image), p('outside')]);
    const host = document.createElement('div'), root = createRoot(host); roots.push(root);
    await act(async () => root.render(<EditorContent editor={editor}/>));
    await vi.waitFor(() => expect(host.querySelector('.nb-callout-tail')).not.toBeNull());
    await act(async () => (host.querySelector('.nb-callout-tail') as HTMLButtonElement).click());
    expect(editor.state.selection.$from.node(1).type.name).toBe('githubAlert');
    expect(host.querySelector('.nb-callout-tail')).toBeNull();
    await act(async () => { editor.commands.undo(); editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1))); });
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => host.querySelector('.alert-body')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(editor.state.selection.$from.node(1).type.name).toBe('githubAlert');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });
});
