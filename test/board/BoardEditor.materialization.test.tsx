import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BoardEditor } from '../../src/features/board/BoardEditor';
import { createEmptyScene, serializeScene, type ExcalidrawScene } from '../../src/features/board/sceneIo';
import { getEditorCapabilities, getDocumentRevision, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';
import { clearAllDocumentHistories, getCurrentDocumentHistoryContent, undoDocumentHistory, redoDocumentHistory } from '../../src/features/history/documentHistory';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { queuedAutoSave } from '../../src/features/session/documentSession';

interface CanvasProps {
  initialData: ExcalidrawScene;
  onChange: (elements: ExcalidrawScene['elements'], appState: ExcalidrawScene['appState'], files: ExcalidrawScene['files']) => void;
  excalidrawAPI: (api: { updateScene: (scene: Partial<ExcalidrawScene>) => void; addFiles: () => void }) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
}
const mock = vi.hoisted(() => ({ props: null as CanvasProps | null, scene: null as ExcalidrawScene | null }));
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: (props: CanvasProps) => {
  mock.props = props;
  React.useEffect(() => {
    mock.scene = { ...createEmptyScene(false), ...props.initialData };
    props.excalidrawAPI({ updateScene: scene => {
      mock.scene = { ...mock.scene!, ...scene };
      props.onChange(mock.scene.elements, mock.scene.appState, mock.scene.files);
    }, addFiles: () => {} });
    props.onChange(mock.scene.elements, mock.scene.appState, mock.scene.files);
  }, []);
  return <div />;
} }));
vi.mock('../../src/features/board/FlowchartQuickConnect', () => ({ FlowchartQuickConnect: () => null }));
vi.mock('../../src/features/board/BoardPresentationToggle', () => ({ BoardPresentationToggle: () => null }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../../src/features/session/documentSession', () => ({ queuedAutoSave: vi.fn().mockResolvedValue(undefined), submitCapturedContent: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setFullscreen: vi.fn() }) }));

const key = 'untitled:board-materialization';
let root: Root;
let host: HTMLDivElement;
let initial: string;
const emit = (x: number) => {
  mock.scene!.elements[0].x = x;
  mock.scene!.elements[0].version++;
  mock.props!.onChange(mock.scene!.elements, mock.scene!.appState, mock.scene!.files);
};
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.clearAllMocks(); clearAllDocumentHistories(); resetEditorRegistryForTest();
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  const scene = createEmptyScene(false);
  scene.elements = [{ id: 'a', type: 'rectangle', x: 0, y: 0, version: 1, versionNonce: 1, isDeleted: false } as ExcalidrawScene['elements'][number]];
  initial = serializeScene(scene);
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'board', dirPath: '', kind: 'board', language: 'plaintext', content: initial, encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, path: null, displayName: 'board', kind: 'board', language: 'plaintext', isDirty: false, isPreview: false, viewMode: null, externalStatus: null, isDetached: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<BoardEditor docKey={key} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('marks close protection immediately while deferring a held gesture and saves its final frame after pointerup', async () => {
  await act(async () => { mock.props!.onPointerDown(); emit(1); emit(2); });
  expect(useWindowStore.getState().getTab(key)?.isDirty).toBe(true);
  expect(getDocumentRevision(key)).toBe(2);
  expect(useDocumentStore.getState().getDocument(key)?.content).toBe(initial);
  expect(getEditorCapabilities(key)?.canSuspend?.()).toBe(false);
  await act(async () => { vi.advanceTimersByTime(1_000); });
  expect(queuedAutoSave).not.toHaveBeenCalled();
  await act(async () => { mock.props!.onPointerUp(); emit(3); vi.advanceTimersByTime(0); });
  expect(JSON.parse(getCurrentDocumentHistoryContent(key)!).elements[0].x).toBe(3);
  await act(async () => { vi.advanceTimersByTime(800); });
  expect(JSON.parse(vi.mocked(queuedAutoSave).mock.calls[0][1]!).elements[0].x).toBe(3);
  await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
  expect(mock.scene!.elements[0].x).toBe(0);
  await act(async () => { expect(redoDocumentHistory(key)).toBe(true); });
  expect(mock.scene!.elements[0].x).toBe(3);
});

it('flushes before idle and preserves viewport without making selection dirty', async () => {
  await act(async () => {
    mock.scene!.appState = { ...mock.scene!.appState, zoom: 2, selectedElementIds: { a: true } };
    mock.props!.onChange(mock.scene!.elements, mock.scene!.appState, mock.scene!.files);
  });
  expect(useWindowStore.getState().getTab(key)?.isDirty).toBe(false);
  expect(getDocumentRevision(key)).toBe(0);
  const viewport = await getEditorCapabilities(key)!.flush('save');
  expect(JSON.parse(viewport!.content!).appState.zoom).toBe(2);
  await act(async () => { emit(5); });
  let captured: Awaited<ReturnType<NonNullable<ReturnType<typeof getEditorCapabilities>>['flush']>>;
  await act(async () => { captured = await getEditorCapabilities(key)!.flush('save'); });
  expect(JSON.parse(captured!.content!).elements[0].x).toBe(5);
  await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
  expect(mock.scene!.elements[0].x).toBe(0);
});

it('does not recreate history when a pending edit is discarded before unmount', async () => {
  await act(async () => { emit(9); });
  useDocumentStore.getState().remove(key);
  clearAllDocumentHistories();
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(getCurrentDocumentHistoryContent(key)).toBeNull();
  expect(useDocumentStore.getState().getDocument(key)).toBeUndefined();
});

it('keeps the final pointerup frame in the same undo group after a mid-gesture save and pause', async () => {
  await act(async () => { mock.props!.onPointerDown(); emit(1); await getEditorCapabilities(key)!.flush('save'); });
  await act(async () => { vi.advanceTimersByTime(1000); mock.props!.onPointerUp(); emit(2); vi.advanceTimersByTime(0); });
  await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
  expect(mock.scene!.elements[0].x).toBe(0);
  await act(async () => { expect(redoDocumentHistory(key)).toBe(true); });
  expect(mock.scene!.elements[0].x).toBe(2);
});
