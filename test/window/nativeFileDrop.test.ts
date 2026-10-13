import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWindowFileDrop } from '@/features/window/nativeFileDrop';
import { clearNativeFileDropTargets, isNativeFileDropDuplicate, registerNativeFileDropTarget, type NativeFileDropTarget } from '@/core/editor/fileDropTargets';
import { useLayoutStore } from '@/stores/layoutStore';
import { showToast } from '@/stores/toastStore';

vi.mock('@/stores/toastStore', () => ({ showToast: vi.fn() }));
const position = { x: 80, y: 60 }, image = ['C:\\photo.png'], mixed = [...image, 'C:\\document.nb'];
const open = vi.fn(async () => {}), cleanups: (() => void)[] = [];
let hit: HTMLElement;
function surface(zone?: string) {
  const element = document.createElement('div');
  if (zone) element.dataset.fileDropZone = zone;
  document.body.append(element); return element;
}
function target(zone: 'workspace' | 'insert', overrides: Partial<NativeFileDropTarget> = {}) {
  const item = { zone, hover: vi.fn(() => true), drop: vi.fn(() => true), clear: vi.fn(), ...overrides };
  cleanups.push(registerNativeFileDropTarget(item)); return item;
}
beforeEach(() => {
  hit = document.body; vi.clearAllMocks(); useLayoutStore.setState({ isDraggingFile: false });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) });
});
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); clearNativeFileDropTargets(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('exclusive native file drop destinations', () => {
  it('opens files only on the explicitly marked tab bar or home, without a document fallback', async () => {
    hit = surface('open');
    await handleWindowFileDrop({ type: 'enter', paths: mixed, position }, open);
    expect(useLayoutStore.getState().isDraggingFile).toBe(true);
    await handleWindowFileDrop({ type: 'drop', paths: mixed, position }, open);
    expect(open).toHaveBeenCalledExactlyOnceWith(mixed);
    expect(useLayoutStore.getState().isDraggingFile).toBe(false);
    hit = surface(); await handleWindowFileDrop({ type: 'drop', paths: image, position }, open);
    expect(open).toHaveBeenCalledOnce(); expect(showToast).toHaveBeenCalledWith(expect.stringContaining('顶部标签栏'), 'info');
  });
  it('routes a workspace drop exclusively to copying, independent of target registration order', async () => {
    const editor = target('insert'), workspace = target('workspace', { accepts: () => true });
    hit = surface('workspace');
    await handleWindowFileDrop({ type: 'enter', paths: mixed, position }, open);
    await handleWindowFileDrop({ type: 'drop', paths: mixed, position }, open);
    expect(workspace.drop).toHaveBeenCalledExactlyOnceWith(mixed, position);
    expect(editor.drop).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().isDraggingFile).toBe(false);
  });
  it('inserts supported images and rejects mixed/unsupported files without opening or partially inserting', async () => {
    const editor = target('insert'); hit = surface('insert');
    await handleWindowFileDrop({ type: 'drop', paths: image, position }, open);
    expect(editor.drop).toHaveBeenCalledOnce();
    await handleWindowFileDrop({ type: 'drop', paths: mixed, position }, open);
    expect(editor.drop).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('正文支持拖入图片'), 'info');
    expect(isNativeFileDropDuplicate([new File([], 'photo.png'), new File([], 'document.nb')])).toBe(true);
  });
  it.each(['workspace', 'insert'] as const)('keeps an unavailable %s target inside its owning surface', async zone => {
    target(zone, { drop: vi.fn(() => false), hover: vi.fn(() => false) }); hit = surface(zone);
    await handleWindowFileDrop({ type: 'enter', paths: image, position }, open);
    expect(useLayoutStore.getState().isDraggingFile).toBe(false);
    await handleWindowFileDrop({ type: 'drop', paths: image, position }, open);
    expect(open).not.toHaveBeenCalled(); expect(showToast).toHaveBeenCalledOnce();
  });
  it('switches feedback as the pointer moves between open, workspace and document regions', async () => {
    const workspace = target('workspace', { accepts: () => true }), editor = target('insert');
    hit = surface('open'); await handleWindowFileDrop({ type: 'enter', paths: image, position }, open);
    expect(useLayoutStore.getState().isDraggingFile).toBe(true);
    hit = surface('workspace'); await handleWindowFileDrop({ type: 'over', position }, open);
    expect(useLayoutStore.getState().isDraggingFile).toBe(false); expect(workspace.hover).toHaveBeenCalledOnce();
    hit = surface('insert'); await handleWindowFileDrop({ type: 'over', position }, open);
    expect(editor.hover).toHaveBeenCalledOnce();
    await handleWindowFileDrop({ type: 'leave' }, open);
    expect(workspace.clear).toHaveBeenCalled(); expect(editor.clear).toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it('does not reach a region through an overlapping menu or dialog, and converts high-DPI coordinates once', async () => {
    target('insert');
    const panel = surface('open'); hit = document.createElement('div'); hit.setAttribute('role', 'menu'); panel.append(hit);
    await handleWindowFileDrop({ type: 'drop', paths: image, position }, open); expect(open).not.toHaveBeenCalled();
    hit = surface('insert'); vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    await handleWindowFileDrop({ type: 'drop', paths: image, position }, open);
    expect(document.elementFromPoint).toHaveBeenLastCalledWith(40, 30);
  });
});
