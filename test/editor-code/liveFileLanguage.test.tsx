import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import { CodeStatusSettings } from '../../src/components/statusbar/CodeStatusSettings';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { getEditorCapabilities, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';

vi.mock('../../src/core/ipc/commands', () => ({ setDocumentDirty: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/features/editor-code/languages', () => ({ loadLanguageExtension: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/features/editor-code/DelimitedPreview', () => ({ DelimitedPreview: ({ text }: { text: string }) => <div data-test-table>{text}</div> }));

const key = 'C:\\test\\sample.txt';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const initialSettings = useSettingsStore.getState().settings;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  useDocumentStore.getState().clear();
  resetEditorRegistryForTest();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); useSettingsStore.setState({ settings: initialSettings }); });
function showLineNumbers(enabled: boolean) {
  useSettingsStore.setState(({ settings }) => ({ settings: { ...settings, editor: { ...settings.editor, showLineNumbers: enabled } } }));
}
function seed(path = key, content = 'hello') {
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: path, dirPath: 'C:\\test', kind: 'code', language: 'plaintext', content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 0, readonly: false });
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
    showLineNumbers(false);
    await act(async () => root.render(<CodeEditor docKey={key} />));
    expect(host.querySelector('.cm-lineNumbers')).toBeNull();
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    const instance = getEditorCapabilities(key)!.instanceId;
    act(() => view.dispatch({ changes: { from: 5, insert: ' world' }, selection: { anchor: 11 } }));
    const dirty = useDocumentStore.getState().getDocument(key)!.isDirty;
    await act(async () => useDocumentStore.getState().setLanguage(key, 'python'));
    expect(host.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)).toBe(view);
    expect(getEditorCapabilities(key)!.instanceId).toBe(instance);
    expect(view.state.doc.toString()).toBe('hello world');
    expect(view.state.selection.main.head).toBe(11);
    expect(useDocumentStore.getState().getDocument(key)!.isDirty).toBe(dirty);
    await act(async () => useDocumentStore.getState().setLanguage(key, 'plaintext'));
    expect(host.querySelector('.cm-lineNumbers')).toBeNull();
    expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)).toBe(view);
    await act(async () => { expect((await getEditorCapabilities(key)!.flush('save'))!.content).toBe('hello world'); });
  });

  it('follows the active source cursor through edits and switches, and opens that editor’s jump-to-line command', async () => {
    const other = 'C:\\test\\other.txt';
    seed(key, 'abc\ndef');
    seed(other);
    const renderStatusFor = async (docKey: string) => await act(async () => root.render(<>
      <CodeEditor docKey={key} />
      <CodeEditor docKey={other} />
      <CodeStatusSettings docKey={docKey} language="plaintext" />
    </>));
    const position = () => host.querySelector<HTMLButtonElement>('[aria-label^="跳转到行，当前"]')!;

    await renderStatusFor(key);
    const [first, second] = Array.from(host.querySelectorAll<HTMLElement>('.cm-editor'), element => EditorView.findFromDOM(element)!);
    expect(position().textContent).toBe('第 1 行，第 1 列');
    await act(async () => first.dispatch({ selection: { anchor: 0, head: 5 } }));
    expect(position().textContent).toBe('第 2 行，第 2 列');
    await act(async () => first.dispatch({ changes: { from: 0, insert: 'new\n' } }));
    expect(position().textContent).toBe('第 3 行，第 2 列');

    await act(async () => second.dispatch({ selection: { anchor: 3 } }));
    await renderStatusFor(other);
    expect(position().textContent).toBe('第 1 行，第 4 列');
    await act(async () => first.dispatch({ selection: { anchor: 0 } }));
    expect(position().textContent).toBe('第 1 行，第 4 列');
    await act(async () => position().click());
    expect(first.dom.querySelector('input[name="line"]')).toBeNull();
    expect(second.dom.querySelector('input[name="line"]')).toBeTruthy();
    await act(async () => { position().focus(); position().click(); });
    expect(second.dom.querySelector('input[name="line"]')).toBeNull();
    expect(second.hasFocus).toBe(true);
    expect(second.state.selection.main.head).toBe(3);
    await act(async () => position().click());
    expect(second.dom.querySelectorAll('input[name="line"]')).toHaveLength(1);
  });

  it('keeps line numbers on a recognized code file despite the plain-text setting', async () => {
    const path = 'C:\\test\\compute.m';
    seed(path);
    useDocumentStore.getState().setLanguage(path, 'matlab');
    showLineNumbers(false);
    await act(async () => root.render(<CodeEditor docKey={path} />));
    expect(host.querySelector('.cm-lineNumbers')).not.toBeNull();
    await act(async () => useDocumentStore.getState().setLanguage(path, 'plaintext'));
    await act(async () => showLineNumbers(true));
    await act(async () => showLineNumbers(false));
    expect(host.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('flushes pending source edits before opening a CSV table and restores source selection', async () => {
    const csv = 'C:\\test\\sample.csv'; seed(csv);
    useWindowStore.getState().openTab({ key: csv, path: csv, displayName: 'sample.csv', kind: 'code', language: 'plaintext',
      isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
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
