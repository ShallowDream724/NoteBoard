import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { registerMdSourceView, registerMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { registerEditorCapabilities, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';
import { captureDocument } from '../../src/features/export/capture';

const fixture = vi.hoisted(() => ({
  tab: { key: 'draft', kind: 'noteboard', viewMode: 'visual', displayName: '草稿.nb' },
  document: { content: 'last saved text', dirPath: 'C:/notes', dirty: true },
  prepare: vi.fn().mockResolvedValue({ html: '', markdown: '', items: [], title: '草稿.nb', baseDirectory: 'C:/notes' }),
}));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({ getDocument: () => fixture.document }) } }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: { getState: () => ({ tabs: [fixture.tab], getTab: () => fixture.tab }) } }));
vi.mock('../../src/stores/fontPackStore', () => ({ useFontPackStore: { getState: () => ({ status: null }) } }));
vi.mock('../../src/features/export/documentConversion', () => ({ prepareDocument: fixture.prepare }));

const dispose: Array<() => void> = [];
function visual(content: string) {
  const editor = new Editor({ extensions: [StarterKit], content: `<p>${content}</p>` });
  dispose.push(() => editor.destroy(), registerMdTipTapEditor('draft', editor));
  return editor;
}
function capability(content: string | null) {
  const flush = vi.fn().mockResolvedValue(content === null ? null : { docKey: 'draft', instanceId: 'test', revision: 3, content });
  dispose.push(registerEditorCapabilities({ docKey: 'draft', instanceId: 'test', getRevision: () => 3,
    flush, focus() {}, getSelectedText: () => '', canSuspend: () => false }));
  return flush;
}
beforeEach(() => {
  fixture.tab.kind = 'noteboard'; fixture.tab.viewMode = 'visual';
  fixture.document.content = 'last saved text'; fixture.document.dirty = true;
  fixture.prepare.mockClear();
});
afterEach(() => { dispose.splice(0).reverse().forEach(cleanup => cleanup()); resetEditorRegistryForTest(); });

describe('export current unsaved content without saving the source', () => {
  it('captures live visual edits instead of a delayed store mirror, without dispatching history', async () => {
    const editor = visual('旧内容');
    editor.commands.insertContentAt(4, '最新未保存修改');
    const flush = capability('stale capability mirror'), transaction = vi.fn();
    editor.on('transaction', transaction);
    const expected = editor.state.doc.toJSON(), state = editor.state;
    const result = await captureDocument('draft');
    expect(result.source).toEqual(expected);
    expect(fixture.prepare).toHaveBeenCalledWith(expected, '草稿.nb', 'C:/notes', undefined, 'noteboard');
    expect(flush).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled(); expect(editor.state).toBe(state);
    expect(fixture.document).toEqual({ content: 'last saved text', dirPath: 'C:/notes', dirty: true });
    editor.commands.insertContent('later edit');
    expect(result.source).toEqual(expected);
  });

  it('uses current source-mode text even when a visual instance still exists', async () => {
    visual('inactive visual contents');
    fixture.tab.kind = 'markdown'; fixture.tab.viewMode = 'source';
    const view = new EditorView({ state: EditorState.create({ doc: 'source' }) });
    dispose.push(() => view.destroy(), registerMdSourceView('draft', view));
    view.dispatch({ changes: { from: 6, insert: ' with unsaved $a$' } });
    const state = view.state, result = await captureDocument('draft');
    expect(result.source).toBe('source with unsaved $a$');
    expect(result.inputFormat).toBe('markdown');
    expect(view.state).toBe(state); expect(fixture.document.dirty).toBe(true);
  });

  it('awaits the authoritative flush when no rich editor is mounted', async () => {
    const flush = capability('latest suspended source');
    expect((await captureDocument('draft')).source).toBe('latest suspended source');
    expect(flush).toHaveBeenCalledWith('export');
    expect(fixture.document.content).toBe('last saved text');
  });

  it('refuses a failed live capture instead of silently exporting the old saved text', async () => {
    capability(null);
    await expect(captureDocument('draft')).rejects.toThrow('当前文档暂时无法导出');
    expect(fixture.prepare).not.toHaveBeenCalled();
  });
});
