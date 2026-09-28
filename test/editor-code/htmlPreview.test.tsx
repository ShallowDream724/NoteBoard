// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import { standaloneHtml } from '../../src/features/export/standaloneHtml';
import { useDocumentStore } from '../../src/stores/documentStore';

const path = 'C:\\notes\\page.html';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  useDocumentStore.setState({ documents: new Map() });
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: 'page.html', dirPath: 'C:\\notes', kind: 'code', language: 'html', content: '<h1>原文</h1>', encoding: 'utf8', eol: 'lf', size: 12, mtime: 1, readonly: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('opens an isolated reading preview and refreshes it from unsaved source edits', async () => {
  await act(async () => root.render(<CodeEditor docKey={path} />));
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.srcdoc).toContain('原文');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
  expect(view).not.toBeNull();
  await act(async () => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: '<h1>新稿</h1>' } }));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!.click());
  expect(host.querySelector<HTMLIFrameElement>('iframe')!.srcdoc).toContain('新稿');
});

it('hides the exported page controls that cannot run in an isolated preview', async () => {
  useDocumentStore.getState().setContent(path, standaloneHtml('<article><h1>正文</h1></article>', '文件名'));
  await act(async () => root.render(<CodeEditor docKey={path} />));
  const source = host.querySelector<HTMLIFrameElement>('iframe')!.srcdoc;
  expect(source).toContain('.export-page-actions{display:none!important}');
  expect(source).toContain('<h1>正文</h1>');
});
