import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import { useDocumentStore } from '../../src/stores/documentStore';
import { getEditorCapabilities, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';

vi.mock('../../src/core/ipc/commands', () => ({ setDocumentDirty: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/editor-code/languages', () => ({ loadLanguageExtension: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/features/editor-code/DelimitedPreview', () => ({ DelimitedPreview: ({ text }: { text: string }) => <div data-test-table>{text}</div> }));

const key = 'C:\\test\\sample.txt';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  useDocumentStore.getState().clear();
  resetEditorRegistryForTest();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function seed(path = key) {
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: path, dirPath: 'C:\\test', kind: 'code', language: 'plaintext', content: 'hello', encoding: 'utf8', eol: 'lf', size: 5, mtime: 0, readonly: false });
}

describe('file syntax and preview lifecycle', () => {
  it('reclassifies special filenames on rename and keeps undecoded binary content external', () => {
    seed('C:\\test\\Dockerfile');
    useDocumentStore.getState().setLanguage('C:\\test\\Dockerfile', 'dockerfile');
    useDocumentStore.getState().renameDocument('C:\\test\\Dockerfile', 'C:\\test\\Gemfile', 'Gemfile', 'C:\\test');
    expect(useDocumentStore.getState().getDocument('C:\\test\\Gemfile')!.language).toBe('ruby');
    useDocumentStore.getState().upsertFromPayload({ key, displayName: key, dirPath: 'C:\\test', kind: 'unsupported', language: 'plaintext', content: null, encoding: 'utf8', eol: 'lf', size: 100, mtime: 0, readonly: true });
    useDocumentStore.getState().renameDocument(key, 'C:\\test\\binary.py', 'binary.py', 'C:\\test');
    expect(useDocumentStore.getState().getDocument('C:\\test\\binary.py')!.kind).toBe('unsupported');
  });
  it('changes syntax without recreating the editor, losing edits or changing dirty metadata', async () => {
    seed();
    await act(async () => root.render(<CodeEditor docKey={key} />));
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    const instance = getEditorCapabilities(key)!.instanceId;
    act(() => view.dispatch({ changes: { from: 5, insert: ' world' }, selection: { anchor: 11 } }));
    const dirty = useDocumentStore.getState().getDocument(key)!.isDirty;
    await act(async () => useDocumentStore.getState().setLanguage(key, 'python'));
    expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)).toBe(view);
    expect(getEditorCapabilities(key)!.instanceId).toBe(instance);
    expect(view.state.doc.toString()).toBe('hello world');
    expect(view.state.selection.main.head).toBe(11);
    expect(useDocumentStore.getState().getDocument(key)!.isDirty).toBe(dirty);
    await act(async () => { expect((await getEditorCapabilities(key)!.flush('save'))!.content).toBe('hello world'); });
  });

  it('flushes pending source edits before opening a CSV table and restores source selection', async () => {
    const csv = 'C:\\test\\sample.csv'; seed(csv);
    await act(async () => root.render(<CodeEditor docKey={csv} />));
    expect(host.querySelector('[data-test-table]')?.textContent).toBe('hello');
    const clickMode = async (label: string) => { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); };
    await clickMode('源码');
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 5, insert: ',value' }, selection: { anchor: 11 } }));
    await clickMode('表格');
    expect(host.querySelector('.cm-editor')).toBeNull();
    expect(host.querySelector('[data-test-table]')?.textContent).toBe('hello,value');
    await clickMode('源码');
    const restored = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    expect(restored.state.doc.toString()).toBe('hello,value');
    expect(restored.state.selection.main.head).toBe(11);
  });
});
