import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '@/features/editor-code/CodeEditor';
import { getEditorCapabilities, resetEditorRegistryForTest } from '@/core/editor/editorRegistry';
import { flushDocument, writeDocumentWithBarrier } from '@/features/session/documentSession';
import { clearAllDocumentHistories, clearDocumentHistory, getCurrentDocumentHistoryContent,
  getDocumentHistoryAvailability, redoDocumentHistory, subscribeDocumentHistory, undoDocumentHistory,
} from '@/features/history/documentHistory';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import * as ipc from '@/core/ipc/commands';

const harness = vi.hoisted(() => ({ views: [] as unknown[] }));

// Exercise CodeEditor's actual update listener with real immutable Text and
// CodeMirror history. Rendering is omitted so its incidental slice/string reads
// cannot be mistaken for serialization performed by the application hot path.
vi.mock('@codemirror/view', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/view')>();
  class InputView {
    state: EditorState;
    scrollDOM = document.createElement('div');
    composing = false;
    flatten = [] as ReturnType<typeof vi.spyOn>[];
    constructor({ state }: { state: EditorState }) { this.state = state; harness.views.push(this); }
    dispatch(spec: TransactionSpec) {
      const startState = this.state;
      const transaction = startState.update(spec);
      this.state = transaction.state;
      if (transaction.docChanged) this.flatten.push(vi.spyOn(this.state.doc, 'toString'));
      const update = { view: this, startState, state: this.state, docChanged: transaction.docChanged,
        selectionSet: transaction.selection !== undefined, transactions: [transaction] } as unknown as ViewUpdate;
      for (const listener of this.state.facet(actual.EditorView.updateListener)) listener(update);
    }
    focus() {}
    requestMeasure() {}
    destroy() {}
  }
  Object.setPrototypeOf(InputView, actual.EditorView);
  return { ...actual, EditorView: InputView };
});
vi.mock('@/features/editor-code/textAnalysisLifecycle', () => ({
  textAnalysisLifecycle: [], getAnalysisOwner: () => ({ cancel: vi.fn() }),
}));
vi.mock('@/features/editor-code/languages', () => ({ loadLanguageExtension: async () => [] }));
vi.mock('@/features/editor-code/lint', () => ({ getLinterForLanguage: () => null }));
vi.mock('@/features/staging/stagingManager', () => ({ onDocumentSaved: vi.fn() }));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('@/core/ipc/commands', () => ({
  setDocumentDirty: vi.fn().mockResolvedValue(undefined),
  writeDocument: vi.fn().mockResolvedValue({ ok: true, mtime: 1, size: 1, error: null }),
}));

type TestView = EditorView & { flatten: ReturnType<typeof vi.spyOn>[] };
let mounts: Array<{ root: Root; host: HTMLDivElement; closed: boolean }>;

function seed(key: string, content: string, source = false) {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: key.split('/').pop()!, dirPath: 'C:/test',
    kind: 'code', language: key.endsWith('.html') ? 'html' : 'plaintext', content, encoding: 'utf8', eol: 'lf',
    size: content.length, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: key.split('/').pop()!, path: key, kind: 'code',
    language: key.endsWith('.html') ? 'html' : 'plaintext', isDirty: false, isPreview: false,
    viewMode: source ? 'source' : 'visual', externalStatus: null, isDetached: false });
}

async function mount(key: string) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const mounted = { root: createRoot(host), host, closed: false }; mounts.push(mounted);
  await act(async () => { mounted.root.render(<CodeEditor docKey={key} />); });
  return { ...mounted, view: harness.views.at(-1) as TestView, close: async () => {
    if (mounted.closed) return;
    mounted.closed = true;
    await act(async () => mounted.root.unmount()); host.remove();
  } };
}

async function type(view: TestView, suffix: string, newGroup = false) {
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: suffix },
    annotations: [Transaction.userEvent.of('input.type'), ...(newGroup ? [isolateHistory.of('before')] : [])] }));
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.clearAllMocks(); harness.views = []; mounts = [];
  vi.mocked(ipc.writeDocument).mockResolvedValue({ ok: true, mtime: 1, size: 1, error: null });
  vi.mocked(ipc.setDocumentDirty).mockResolvedValue(undefined);
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  clearAllDocumentHistories(); resetEditorRegistryForTest();
});
afterEach(async () => {
  for (const mounted of mounts) if (!mounted.closed) {
    await act(async () => mounted.root.unmount()); mounted.host.remove();
  }
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('code immutable input snapshots', () => {
  it('keeps 6 MiB continuous input unflattened and saves its current text immediately', async () => {
    const key = 'C:/test/large.txt';
    const content = `${'x'.repeat(63)}\n`.repeat(6 * 1024 * 1024 / 64);
    seed(key, content);
    const { view } = await mount(key);
    for (const suffix of ['A', 'B', 'C', 'D']) await type(view, suffix);
    expect(view.flatten.map(spy => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe(content);
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(true);
    expect(getEditorCapabilities(key)?.hasUnconfirmedInput?.()).toBe(true);
    expect(getDocumentHistoryAvailability(key).canUndo).toBe(true);

    await act(async () => {
      const captured = await flushDocument(key, 'save');
      expect(captured?.content).toBe(`${content}ABCD`);
      expect(await writeDocumentWithBarrier(key, captured!.content!)).toBe(true);
    });
    expect(ipc.writeDocument).toHaveBeenCalledWith(key, `${content}ABCD`, 'utf8', 'lf');
    expect(view.flatten.map(spy => spy.mock.calls.length)).toEqual([0, 0, 0, 1]);
    expect(getEditorCapabilities(key)?.hasUnconfirmedInput?.()).toBe(false);
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
  });

  it('enables immediate toolbar undo before the first debounce and restores the original', async () => {
    const key = 'C:/test/immediate.txt'; seed(key, 'before');
    const changes: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    const { view } = await mount(key);
    const unsubscribe = subscribeDocumentHistory((changed, availability) => {
      if (changed === key) changes.push(availability);
    });
    await type(view, ' after');
    expect(changes.at(-1)).toEqual({ canUndo: true, canRedo: false });
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('before');
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
    expect(getDocumentHistoryAvailability(key)).toEqual({ canUndo: false, canRedo: true });
    await act(async () => { expect(redoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('before after');
    unsubscribe();
  });

  it('autosaves the latest group after debounce without flattening its text again', async () => {
    const key = 'C:/test/auto.txt'; seed(key, 'before');
    const documents = new Map(useDocumentStore.getState().documents);
    documents.set(key, { ...documents.get(key)!, savePolicy: 'auto' });
    useDocumentStore.setState({ documents });
    const { view } = await mount(key);
    await type(view, ' A'); await type(view, 'B');
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(ipc.writeDocument).toHaveBeenCalledWith(key, 'before AB', 'utf8', 'lf');
    expect(view.flatten.map(spy => spy.mock.calls.length)).toEqual([0, 1]);
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
  });

  it('materializes each group before the next and undoes to its complete intermediate endpoint', async () => {
    const key = 'C:/test/groups.txt'; seed(key, 'start');
    const { view } = await mount(key);
    await type(view, ' A'); await type(view, 'B');
    await type(view, ' C', true); await type(view, 'D');
    expect(view.flatten.map(spy => spy.mock.calls.length)).toEqual([0, 1, 0, 0]);
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('start AB');
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('start');
    await act(async () => { expect(redoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('start AB');
    await act(async () => { expect(redoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('start AB CD');
  });

  it('clears conservative dirty after typing back to the existing mirror and baseline', async () => {
    const key = 'C:/test/revert.txt'; seed(key, 'original');
    const { view } = await mount(key);
    await type(view, 'x');
    await act(async () => view.dispatch({ changes: { from: view.state.doc.length - 1, to: view.state.doc.length },
      annotations: Transaction.userEvent.of('delete.backward') }));
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('original');
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
    expect(useWindowStore.getState().getTab(key)?.isDirty).toBe(false);
  });

  it('retains pending text and history when leaving HTML source for preview', async () => {
    const key = 'C:/test/preview.html'; seed(key, '<p>before</p>', true);
    const mounted = await mount(key);
    await type(mounted.view, '<p>after</p>');
    await act(async () => { [...mounted.host.querySelectorAll('button')].find(button => button.textContent === '预览')!.click(); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('<p>before</p><p>after</p>');
    expect(getCurrentDocumentHistoryContent(key)).toBe('<p>before</p><p>after</p>');
    expect(getEditorCapabilities(key)).toBeNull();
    await act(async () => { [...mounted.host.querySelectorAll('button')].find(button => button.textContent === '源码')!.click(); });
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('<p>before</p>');
  });

  it('confirms current input on unmount and captures view state without a second flatten', async () => {
    const key = 'C:/test/suspend.txt'; seed(key, 'before');
    const first = await mount(key);
    await type(first.view, ' first');
    await first.close();
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('before first');
    expect(first.view.flatten[0].mock.calls.length).toBe(1);
    const next = await mount(key);
    await type(next.view, ' second');
    await act(async () => {
      getEditorCapabilities(key)?.captureViewState?.();
      getEditorCapabilities(key)?.captureViewState?.();
      await getEditorCapabilities(key)?.flush('save');
    });
    expect(next.view.flatten[0].mock.calls.length).toBe(1);
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('before first');
  });

  it('rejects old pending timers, flush and cleanup after the same path closes and reopens', async () => {
    const key = 'C:/test/reopen.txt'; seed(key, 'old');
    const old = await mount(key); const staleCapabilities = getEditorCapabilities(key)!;
    await type(old.view, ' pending');
    await act(async () => {
      useDocumentStore.getState().remove(key); clearDocumentHistory(key);
      seed(key, 'new session');
    });
    const fresh = await mount(key); const freshCapabilities = getEditorCapabilities(key);
    await type(fresh.view, ' current');
    await act(async () => { await staleCapabilities.flush('save'); await old.close(); await vi.advanceTimersByTimeAsync(500); });
    expect(getEditorCapabilities(key)).toBe(freshCapabilities);
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('new session current');
    expect(getCurrentDocumentHistoryContent(key)).toBe('new session current');
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(useDocumentStore.getState().getDocument(key)?.content).toBe('new session');
  });
});
