import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
const restart = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../src/features/learning/startInteractivePractice', () => ({ startInteractivePractice: restart.start }));
vi.mock('../../src/stores/windowStore', async () => {
  const { create } = await import('zustand');
  return { useWindowStore: create(() => ({ tabs: [], activeKey: null })) };
});
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { decodeNativeDocument } from '../../src/core/nativeDocument';
import { initializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { createPracticeContent, PRACTICE_WORD } from '../../src/features/learning/practiceCourse';
import { findPracticeText } from '../../src/features/learning/practiceDetection';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { InteractivePracticePanel } from '../../src/features/learning/InteractivePracticePanel';

let root: Root, editor: Editor;
const click = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.nb-practice-panel button')).find(button => button.textContent === text)!.click();
const render = (activeEditor: Editor | null = editor, activeKey = 'practice') => root.render(<InteractivePracticePanel activeEditor={activeEditor} activeKey={activeKey}/>);
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const content = createPracticeContent(); editor = new Editor({ extensions: buildDocumentExtensions(), content: decodeNativeDocument(content) });
  initializeEditorDocument(editor, content, 'noteboard', '', 'practice');
  const host = document.createElement('div'); document.body.append(host, editor.view.dom); root = createRoot(host);
  useWindowStore.setState({ tabs: [{ key: 'practice', kind: 'noteboard' } as Tab, { key: 'other', kind: 'noteboard' } as Tab], activeKey: 'practice' });
  usePracticeStore.getState().start('practice'); await act(async () => render());
});
afterEach(async () => { await act(async () => root.unmount()); editor.destroy(); usePracticeStore.getState().exit(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); restart.start.mockReset(); });

it('marks actual selection complete and waits for explicit continuation without moving the caret', async () => {
  const range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
  await act(async () => editor.commands.setTextSelection(range));
  expect(usePracticeStore.getState().completed).toEqual(['selection']); expect(usePracticeStore.getState().stepId).toBe('selection');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('已完成'); expect(editor.state.selection.from).toBe(range.from);
  await act(async () => click('继续')); expect(usePracticeStore.getState().stepId).toBe('highlight'); expect(editor.state.selection.from).toBe(range.from);
});
it('supports skipping, revisiting and collapsing, and exits while preserving the document', async () => {
  const doc = editor.state.doc, tabs = useWindowStore.getState().tabs;
  await act(async () => click('跳过此项')); expect(usePracticeStore.getState().skipped).toEqual(['selection']);
  await act(async () => document.querySelector<HTMLButtonElement>('.nb-practice-course li button')!.click()); expect(usePracticeStore.getState().stepId).toBe('selection');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="收起练习任务"]')!.click()); expect(document.querySelector('.nb-practice-body')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="退出练习"]')!.click());
  expect(usePracticeStore.getState().sessionKey).toBeNull(); expect(editor.state.doc).toBe(doc); expect(useWindowStore.getState().tabs).toBe(tabs);
});
it('pauses on another tab and rejects an old editor during the return transition', async () => {
  const range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
  await act(async () => { useWindowStore.setState({ activeKey: 'other' }); render(editor, 'other'); });
  expect(document.querySelector('.nb-practice-panel')).toBeNull(); editor.commands.setTextSelection(range); expect(usePracticeStore.getState().completed).toEqual([]);
  const foreign = new Editor({ extensions: buildDocumentExtensions(), content: '<p>观察与记录</p>' });
  initializeEditorDocument(foreign, createPracticeContent(), 'noteboard', '', 'other');
  foreign.commands.setTextSelection({ from: 1, to: 6 });
  await act(async () => { useWindowStore.setState({ activeKey: 'practice' }); render(foreign); });
  expect(usePracticeStore.getState().completed).toEqual([]); expect(document.querySelector('[role="status"]')?.textContent).toContain('切回可视化');
  await act(async () => render()); expect(usePracticeStore.getState().completed).toEqual(['selection']); foreign.destroy();
});
it('requests a fresh copy only through explicit restart', async () => {
  restart.start.mockResolvedValue('new-practice'); const doc = editor.state.doc;
  await act(async () => click('重新练习'));
  expect(restart.start).toHaveBeenCalledWith({ fresh: true }); expect(editor.state.doc).toBe(doc);
});
