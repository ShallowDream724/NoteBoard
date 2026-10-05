import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
vi.mock('../../src/stores/windowStore', async () => {
  const { create } = await import('zustand');
  return { useWindowStore: create(() => ({ tabs: [], activeKey: null })) };
});
const targets = vi.hoisted(() => ({ resolve: vi.fn(), complete: vi.fn() }));
vi.mock('../../src/features/learning/guideTargets', () => ({
  resolveGuideTarget: targets.resolve, guideUICompleted: targets.complete, visibleGuideElement: () => null,
}));
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { initializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { GUIDE_WORD } from '../../src/features/learning/practiceCourse';
import { findPracticeText } from '../../src/features/learning/practiceDetection';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { InteractivePracticePanel } from '../../src/features/learning/InteractivePracticePanel';

let root: Root, editor: Editor;
const mutationDisconnect = vi.fn(), resizeDisconnect = vi.fn();
const render = (activeEditor: Editor | null = editor, activeKey = 'showcase') => root.render(<InteractivePracticePanel activeEditor={activeEditor} activeKey={activeKey}/>);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
const alert: JSONContent = { type: 'githubAlert', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有提示' }] }] };
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (timer: number) => clearTimeout(timer));
  vi.stubGlobal('MutationObserver', class { observe() {} takeRecords() { return []; } disconnect = mutationDisconnect; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = resizeDisconnect; });
  mutationDisconnect.mockClear(); resizeDisconnect.mockClear(); targets.complete.mockReturnValue(false);
  targets.resolve.mockReturnValue({ element: null, rects: [{ left: 100, top: 120, width: 100, height: 20 }, { left: 100, top: 144, width: 60, height: 20 }] });
  const content: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: GUIDE_WORD }] }, alert] };
  editor = new Editor({ extensions: buildDocumentExtensions(), content }); initializeEditorDocument(editor, encodeNativeDocument(content), 'noteboard', '', 'showcase');
  const host = document.createElement('div'); document.body.append(host, editor.view.dom); root = createRoot(host);
  useWindowStore.setState({ tabs: [{ key: 'showcase', kind: 'noteboard' } as Tab, { key: 'other', kind: 'noteboard' } as Tab], activeKey: 'showcase' });
  usePracticeStore.getState().start('showcase'); await act(async () => render()); await tick();
});
afterEach(async () => {
  await act(async () => root.unmount()); editor.destroy(); usePracticeStore.getState().exit();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('renders a portal with separate multiline rings and completes exact selection without moving the caret', async () => {
  expect(document.querySelectorAll('[data-guide-spotlight]')).toHaveLength(2); expect(document.querySelector('[data-guide-arrow]')).not.toBeNull();
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => usePracticeStore.getState().selectStep('selection')); await tick();
  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection'); expect(editor.state.selection.from).toBe(range.from);
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(usePracticeStore.getState().stepId).toBe('highlight'); expect(editor.state.selection.from).toBe(range.from);
});
it('pauses on another tab, refuses a foreign editor and releases its observers', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!, off = vi.spyOn(editor, 'off');
  await act(async () => { usePracticeStore.getState().selectStep('selection'); }); await tick();
  const mutationStops = mutationDisconnect.mock.calls.length, resizeStops = resizeDisconnect.mock.calls.length;
  await act(async () => { useWindowStore.setState({ activeKey: 'other' }); render(editor, 'other'); });
  expect(document.querySelector('.nb-onboarding-layer')).toBeNull();
  expect(mutationDisconnect.mock.calls.length).toBeGreaterThan(mutationStops); expect(resizeDisconnect.mock.calls.length).toBeGreaterThan(resizeStops);
  expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
  const measurements = targets.resolve.mock.calls.length;
  editor.commands.setTextSelection(range); await tick(); expect(usePracticeStore.getState().completed).toEqual([]); expect(targets.resolve).toHaveBeenCalledTimes(measurements);
  const foreign = { isDestroyed: false, get state() { throw Error('foreign editor read'); } } as unknown as Editor;
  await act(async () => { useWindowStore.setState({ activeKey: 'showcase' }); render(foreign); }); await tick();
  expect(document.querySelector('.nb-onboarding-layer')).toBeNull(); expect(usePracticeStore.getState().completed).toEqual([]);
});
it('does not count an existing sample callout and waits for a new insertion', async () => {
  await act(async () => usePracticeStore.getState().selectStep('insert-callout')); await tick();
  expect(usePracticeStore.getState().completed).toEqual([]);
  await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size, alert)); await tick();
  expect(usePracticeStore.getState().completed).toEqual(['insert-callout']);
});
it('exits on Escape while preserving the document and tab identity', async () => {
  const doc = editor.state.doc, tabs = useWindowStore.getState().tabs, off = vi.spyOn(editor, 'off');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(usePracticeStore.getState().sessionKey).toBeNull(); expect(document.querySelector('.nb-onboarding-layer')).toBeNull();
  expect(editor.state.doc).toBe(doc); expect(useWindowStore.getState().tabs).toBe(tabs);
  expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
  expect(mutationDisconnect).toHaveBeenCalled(); expect(resizeDisconnect).toHaveBeenCalled();
});
it.each([false, true])('takes a fresh baseline when restarting the same sample (batched: %s)', async batched => {
  if (batched) {
    await act(async () => { usePracticeStore.getState().exit(); editor.commands.insertContentAt(editor.state.doc.content.size, alert); usePracticeStore.getState().start('showcase'); });
  } else {
    await act(async () => usePracticeStore.getState().exit());
    editor.commands.insertContentAt(editor.state.doc.content.size, alert);
    await act(async () => usePracticeStore.getState().start('showcase'));
  }
  await tick();
  await act(async () => usePracticeStore.getState().selectStep('insert-callout')); await tick();
  expect(usePracticeStore.getState().completed).toEqual([]);
});
