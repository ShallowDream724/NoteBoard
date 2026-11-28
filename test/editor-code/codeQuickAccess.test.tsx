import { EditorView } from '@codemirror/view';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import QuickAccessDialog from '../../src/features/quick-access/QuickAccessDialog';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';

vi.mock('../../src/core/ipc/commands', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/core/ipc/commands')>(),
  listRecent: vi.fn().mockResolvedValue({ files: [] }),
  setDocumentDirty: vi.fn().mockResolvedValue(undefined),
}));

it('finds an unsaved symbol through @, jumps with Enter, and returns through the same panel', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const scrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  const key = 'C:\\quick-access\\demo.py';
  const content = 'start = 1\n';
  useDocumentStore.getState().upsertFromPayload({
    key, displayName: 'demo.py', dirPath: 'C:\\quick-access', kind: 'code', language: 'python',
    content, size: content.length, encoding: 'utf8', eol: 'lf', mtime: 0, readonly: false,
  });
  useWindowStore.getState().openTab({ key, path: key, displayName: 'demo.py', kind: 'code', language: 'python',
    isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Workspace() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>快速打开</button>
      <CodeEditor docKey={key} />
      {open && <QuickAccessDialog visualEditor={null} request={{ mode: 'files', previousFocus: null }} onClose={() => setOpen(false)} />}
    </>;
  }
  const enterQuery = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const open = async () => { await act(async () => host.querySelector('button')!.click()); };
  const enter = async () => {
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };

  try {
    await act(async () => root.render(<Workspace />));
    const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: content.length, insert: 'def unsaved(): pass\n' }, selection: { anchor: 0, head: 5 } }));
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe(content);

    await open();
    await enterQuery('@unsaved');
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')?.textContent).toContain('unsaved函数 · 第 2 行'));
    await enter();
    expect(view.state.selection.main.head).toBe(content.length + 'def '.length);

    await open();
    await enterQuery('@');
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe('返回跳转前的位置');
    await enter();
    expect(view.state.selection.main.anchor).toBe(0);
    expect(view.state.selection.main.head).toBe(5);
  } finally {
    act(() => root.unmount());
    host.remove();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Reflect.deleteProperty(Range.prototype, 'getClientRects');
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
    vi.unstubAllGlobals();
  }
});
