import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { PlantUmlBlock } from '@/features/plantuml/plantumlExtension';
import { clearPlantUmlCache } from '@/features/plantuml/plantumlEncoder';
import { TooltipProvider } from '@/components/Tooltip';
import { EditorActivityContext } from '@/core/editor/EditorActivityContext';
import { DiagramSplitEditor } from '@/features/diagram-preview/DiagramSplitEditor';
import { useDocumentStore } from '@/stores/documentStore';

vi.mock('@/features/editor-md/viewportActivation', () => ({ observe: (_element: HTMLElement, callback: () => void) => { callback(); return () => {}; } }));
vi.mock('@/features/editor-md/viewportWorkScheduler', () => ({ scheduleTask: (_id: string, task: () => unknown) => { void task(); }, cancelTask: () => {} }));
vi.mock('@/features/export/ChartExportMenu', () => ({ ChartExportMenu: () => null }));
const fetchMock = vi.fn<typeof fetch>();
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Preview</text></svg>';
let root: Root, host: HTMLDivElement, editor: Editor | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); clearPlantUmlCache();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); editor?.destroy(); }); editor = undefined; host.remove(); clearPlantUmlCache(); useDocumentStore.getState().clear(); vi.unstubAllGlobals(); });
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text);
  expect(found).toBeTruthy(); return found!;
}
async function node(active = true) {
  editor ??= new Editor({ extensions: [StarterKit.configure({ trailingNode: false }), PlantUmlBlock], content: { type: 'doc', content: [{ type: 'plantumlBlock', attrs: { code: 'Alice -> Bob' } }] } });
  await act(async () => root.render(<EditorActivityContext.Provider value={active}><TooltipProvider><EditorContent editor={editor!}/></TooltipProvider></EditorActivityContext.Provider>));
}
it('keeps a visible diagram and its source editor offline until this view enables preview', async () => {
  await node(); expect(fetchMock).not.toHaveBeenCalled(); expect(host.textContent).toContain('plantuml.com');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑图表源码"]')!.click());
  expect(host.querySelector('textarea')?.value).toBe('Alice -> Bob'); expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => button('取消').click());
  fetchMock.mockResolvedValue(new Response(svg));
  await act(async () => button('启用在线预览').click());
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('.nb-diagram-container svg text')?.textContent).toBe('Preview')); });
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => button('关闭在线预览').click());
  await act(async () => editor!.view.dispatch(editor!.state.tr.setNodeMarkup(0, undefined, { code: 'changed offline' })));
  expect(fetchMock).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('未缓存');
});
it('aborts obsolete requests when a node source changes, becomes inactive or unmounts', async () => {
  const signals: AbortSignal[] = [];
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    const signal = options!.signal!; signals.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await node(); await act(async () => button('启用在线预览').click()); expect(signals).toHaveLength(1);
  await act(async () => editor!.view.dispatch(editor!.state.tr.setNodeMarkup(0, undefined, { code: 'changed' })));
  expect(signals[0].aborted).toBe(true); expect(signals).toHaveLength(2);
  await node(false); expect(signals[1].aborted).toBe(true); expect(signals).toHaveLength(2);
  await node(true); expect(signals).toHaveLength(3);
  await act(async () => root.unmount()); expect(signals[2].aborted).toBe(true);
  root = createRoot(host);
});
it('keeps split-document source edits offline, applies current consent to later edits and resets it for a new document', async () => {
  const add = (key: string, code: string) => useDocumentStore.getState().upsertFromPayload({ key, displayName: key, dirPath: '', kind: 'code', language: 'plantuml', content: code, encoding: 'utf8', eol: 'lf', size: code.length, mtime: 0, readonly: false });
  add('one.puml', 'Alice -> Bob'); add('two.puml', 'Other -> Diagram');
  const split = async (key: string, active = true) => act(async () => root.render(<EditorActivityContext.Provider value={active}><TooltipProvider><DiagramSplitEditor docKey={key}/></TooltipProvider></EditorActivityContext.Provider>));
  await split('one.puml'); expect(fetchMock).not.toHaveBeenCalled();
  const { EditorView } = await import('@codemirror/view');
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'edited offline' } }));
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockImplementation(async () => new Response(svg));
  await act(async () => button('启用在线预览').click());
  await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); });
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'edited online' } }));
  await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); });
  await act(async () => button('源码').click());
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'source-only edit' } }));
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(host.querySelector('svg text')).toBeNull();
  await act(async () => button('分屏').click());
  await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)); });
  await split('two.puml'); expect(button('启用在线预览')).toBeTruthy(); expect(fetchMock).toHaveBeenCalledTimes(3);
  await split('two.puml', false); expect(fetchMock).toHaveBeenCalledTimes(3);
});
it('restores cached A after a pending B is cancelled by reverting and after reactivation', async () => {
  fetchMock.mockResolvedValueOnce(new Response(svg));
  await node(); await act(async () => button('启用在线预览').click());
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('.nb-diagram-container svg text')?.textContent).toBe('Preview')); });
  let pendingSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    pendingSignal = options!.signal!; pendingSignal.addEventListener('abort', () => reject(pendingSignal!.reason), { once: true });
  }));
  await act(async () => editor!.view.dispatch(editor!.state.tr.setNodeMarkup(0, undefined, { code: 'pending B' })));
  expect(host.querySelector('.nb-diagram-container svg text')).toBeNull();
  await act(async () => editor!.view.dispatch(editor!.state.tr.setNodeMarkup(0, undefined, { code: 'Alice -> Bob' })));
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('.nb-diagram-container svg text')?.textContent).toBe('Preview')); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await node(false); await node(true);
  expect(host.querySelector('.nb-diagram-container svg text')?.textContent).toBe('Preview'); expect(fetchMock).toHaveBeenCalledTimes(2);
});
