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
import { GUIDE_DISCLOSURE, GUIDE_WORD } from '../../src/features/learning/practiceCourse';
import { findPracticeText } from '../../src/features/learning/practiceDetection';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { InteractivePracticePanel } from '../../src/features/learning/InteractivePracticePanel';

let root: Root, editor: Editor;
const mutationDisconnect = vi.fn(), resizeDisconnect = vi.fn();
const render = (activeEditor: Editor | null = editor, activeKey = 'showcase') => root.render(<InteractivePracticePanel activeEditor={activeEditor} activeKey={activeKey}/>);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
const settle = (milliseconds = 350) => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
const alert: JSONContent = { type: 'githubAlert', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有提示' }] }] };
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (timer: number) => clearTimeout(timer));
  vi.stubGlobal('MutationObserver', class { observe() {} takeRecords() { return []; } disconnect = mutationDisconnect; });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect = resizeDisconnect; });
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
  expect(document.querySelectorAll('[data-guide-spotlight]')).toHaveLength(2); expect(document.querySelector('[data-guide-arrow]')).toBeNull();
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  editor.view.setProps({ handleScrollToSelection: () => true });
  await act(async () => editor.view.dom.focus());
  await act(async () => usePracticeStore.getState().selectStep('selection')); await tick();
  expect(document.activeElement).toBe(editor.view.dom);
  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection'); expect(editor.state.selection.from).toBe(range.from);
  expect(document.querySelectorAll('[data-guide-spotlight]')).toHaveLength(0);
  expect(document.querySelector('[aria-label="上手引导"]')).toBeNull();
  expect(document.activeElement).toBe(editor.view.dom);
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(usePracticeStore.getState().stepId).toBe('highlight'); expect(editor.state.selection.from).toBe(range.from);
});
it('automatically advances through all eight real outcomes and exits after the last one', async () => {
  const uiOutcomes = new Set<string>(); targets.complete.mockImplementation((_editor, step: string) => uiOutcomes.has(step));
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!, tabs = useWindowStore.getState().tabs;
  const expectStep = (step: string) => {
    expect(usePracticeStore.getState().stepId).toBe(step);
    expect(document.querySelector('.nb-onboarding-next')).toBeNull();
    expect(document.querySelector('[data-guide-step="summary"]')).toBeNull();
  };
  const showUI = async (step: string) => {
    uiOutcomes.add(step); await act(async () => window.dispatchEvent(new Event('resize'))); await tick();
  };
  expectStep('read-note'); await showUI('read-note');
  expect(usePracticeStore.getState().completed).toContain('read-note');
  await settle(800); expectStep('read-note'); await settle(100); expectStep('selection');

  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection'); await settle(); expectStep('highlight');
  await act(async () => editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.highlight.create()))); await tick();
  expect(usePracticeStore.getState().completed).toContain('highlight'); await settle(); expectStep('annotation-open');
  await showUI('annotation-open'); await settle(); expectStep('annotation-save');
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'saved-note' }, content: [{ type: 'paragraph' }] }] });
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.annotationReference.create({ id: 'saved-note' })));
  }); await tick();
  expect(usePracticeStore.getState().completed).toContain('annotation-save'); await settle(); expectStep('insert-menu');
  await showUI('insert-menu'); await settle(); expectStep('insert-callout');
  await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size, alert)); await tick();
  expect(usePracticeStore.getState().completed).toContain('insert-callout'); await settle(); expectStep('disclosure');
  await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'disclosure', attrs: { title: GUIDE_DISCLOSURE, open: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '水壶' }] }] })); await tick();
  expect(usePracticeStore.getState().completed).toContain('disclosure');
  const doc = editor.state.doc; await settle();
  expect(usePracticeStore.getState().sessionKey).toBeNull(); expect(document.querySelector('.nb-onboarding-layer')).toBeNull();
  expect(editor.state.doc).toBe(doc); expect(useWindowStore.getState().tabs).toBe(tabs);
});
it('does not let pending advancement from an old generation move a restarted guide', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => usePracticeStore.getState().selectStep('selection')); await tick();
  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection'); await settle(200);
  const generation = usePracticeStore.getState().generation;
  await act(async () => { usePracticeStore.getState().exit(); usePracticeStore.getState().start('showcase'); }); await tick();
  expect(usePracticeStore.getState().generation).toBeGreaterThan(generation);
  await settle(1000);
  expect(usePracticeStore.getState().stepId).toBe('read-note'); expect(usePracticeStore.getState().completed).toEqual([]);
});
it('reopens selection when the full phrase is shortened during its completion delay', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => usePracticeStore.getState().selectStep('selection')); await tick();
  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection'); await settle(150);
  await act(async () => editor.commands.setTextSelection({ from: range.from, to: range.to - 1 })); await tick();
  expect(usePracticeStore.getState().completed).not.toContain('selection');
  expect(document.querySelector('[aria-label="上手引导"]')).not.toBeNull();
  await settle(450); expect(usePracticeStore.getState().stepId).toBe('selection');
  await act(async () => editor.commands.setTextSelection(range)); await tick(); await settle();
  expect(usePracticeStore.getState().stepId).toBe('highlight');
});
it('reopens highlight when its mark is removed before automatic advancement', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => { usePracticeStore.getState().selectStep('highlight'); editor.commands.setTextSelection(range); }); await tick();
  await act(async () => editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.highlight.create()))); await tick();
  expect(usePracticeStore.getState().completed).toContain('highlight'); await settle(150);
  await act(async () => editor.view.dispatch(editor.state.tr.removeMark(range.from, range.to, editor.schema.marks.highlight))); await tick();
  expect(usePracticeStore.getState().completed).not.toContain('highlight');
  await settle(450); expect(usePracticeStore.getState().stepId).toBe('highlight');
  await act(async () => editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.highlight.create()))); await tick(); await settle();
  expect(usePracticeStore.getState().stepId).toBe('annotation-open');
});
it('keeps annotation-open active when its draft is cancelled during the completion delay', async () => {
  let opened = false; targets.complete.mockImplementation((_editor, step: string) => step === 'annotation-open' && opened);
  await act(async () => usePracticeStore.getState().selectStep('annotation-open')); await tick();
  opened = true; await act(async () => window.dispatchEvent(new Event('resize'))); await tick();
  expect(usePracticeStore.getState().completed).toContain('annotation-open'); await settle(150);
  opened = false; await act(async () => window.dispatchEvent(new Event('resize'))); await tick();
  expect(usePracticeStore.getState().completed).not.toContain('annotation-open');
  await settle(450); expect(usePracticeStore.getState().stepId).toBe('annotation-open');
});
it('rechecks an opened draft at the advancement boundary even before another geometry frame', async () => {
  let opened = false; targets.complete.mockImplementation((_editor, step: string) => step === 'annotation-open' && opened);
  await act(async () => usePracticeStore.getState().selectStep('annotation-open')); await tick();
  opened = true; await act(async () => window.dispatchEvent(new Event('resize'))); await tick();
  expect(usePracticeStore.getState().completed).toContain('annotation-open');
  opened = false; await settle(350);
  expect(usePracticeStore.getState().stepId).toBe('annotation-open');
  expect(usePracticeStore.getState().completed).not.toContain('annotation-open');
});
it('reopens annotation-save when the saved reference is undone during its completion delay', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => usePracticeStore.getState().selectStep('annotation-save')); await tick();
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'saved-note' }, content: [{ type: 'paragraph' }] }] });
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.annotationReference.create({ id: 'saved-note' })));
  }); await tick();
  expect(usePracticeStore.getState().completed).toContain('annotation-save'); await settle(150);
  await act(async () => editor.view.dispatch(editor.state.tr.removeMark(range.from, range.to, editor.schema.marks.annotationReference))); await tick();
  expect(usePracticeStore.getState().completed).not.toContain('annotation-save');
  await settle(450); expect(usePracticeStore.getState().stepId).toBe('annotation-save');
});
it('pauses pending advancement while the sample tab is inactive', async () => {
  const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
  await act(async () => usePracticeStore.getState().selectStep('selection')); await tick();
  await act(async () => editor.commands.setTextSelection(range)); await tick();
  expect(usePracticeStore.getState().completed).toContain('selection');
  await act(async () => { useWindowStore.setState({ activeKey: 'other' }); render(editor, 'other'); });
  await settle(500); expect(usePracticeStore.getState().stepId).toBe('selection');
  await act(async () => { useWindowStore.setState({ activeKey: 'showcase' }); render(); });
  await settle(); expect(usePracticeStore.getState().stepId).toBe('highlight');
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
it('offers Skip without a dead locate action when the original example phrase is gone', async () => {
  targets.resolve.mockReturnValue({ element: null, rects: [], fallback: 'missing-text' });
  await act(async () => { editor.commands.setContent('<p>已经改写的正文</p>'); usePracticeStore.getState().selectStep('highlight'); }); await tick();
  expect(document.querySelectorAll('[data-guide-spotlight]')).toHaveLength(0);
  expect(document.querySelector('.nb-onboarding-locate')).toBeNull();
  expect(document.querySelector('.nb-onboarding-copy')?.textContent).toContain('这段示例文字已经改动');
  expect(document.querySelector('.nb-onboarding-skip')).not.toBeNull();
  await settle(450); expect(usePracticeStore.getState().stepId).toBe('highlight'); expect(usePracticeStore.getState().completed).toEqual([]);
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
