import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { decodeNativeDocument, encodeNativeDocument } from '../../src/core/nativeDocument';
import { initializeEditorDocument, parseEditorDocument, serializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { clearAllDocumentHistories, initializeDocumentHistory, isApplyingDocumentHistory, recordDocumentChange, redoDocumentHistory, registerDocumentHistoryAdapter, undoDocumentHistory } from '../../src/features/history/documentHistory';
import { ACTION_BLOCK, OBSERVATION_BLOCK, PRACTICE_TASKS, PRACTICE_WORD, createPracticeContent } from '../../src/features/learning/practiceCourse';
import { findPracticeText, observePracticeTask, practiceTaskSatisfied } from '../../src/features/learning/practiceDetection';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: JSONContent = decodeNativeDocument(createPracticeContent()) as JSONContent) {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content });
  initializeEditorDocument(editor, encodeNativeDocument(content), 'noteboard', '', 'practice');
  editors.push(editor); return editor;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); clearAllDocumentHistories(); vi.restoreAllMocks(); });

describe('practice semantic goals', () => {
  it('starts with no task already satisfied', () => {
    const editor = make();
    for (const task of PRACTICE_TASKS) expect(practiceTaskSatisfied(task.id, editor.state), task.id).toBe(false);
  });
  it('requires the exact visible selection and all target letters highlighted', () => {
    const editor = make(), range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to - 1)));
    expect(practiceTaskSatisfied('selection', editor.state)).toBe(false);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to)));
    expect(practiceTaskSatisfied('selection', editor.state)).toBe(true);
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to - 1, editor.schema.marks.highlight.create()));
    expect(practiceTaskSatisfied('highlight', editor.state)).toBe(false);
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.highlight.create({ color: '#ffff00' })));
    expect(practiceTaskSatisfied('highlight', editor.state)).toBe(true);
  });
  it('checks the actual heading, callout, disclosure and formula content', () => {
    const editor = make({ type: 'doc', content: [
      { ...p('周末公园观察'), type: 'heading', attrs: { level: 2 } },
      { type: 'githubAlert', content: [p('记得带水')] },
      { type: 'disclosure', attrs: { title: '装备清单' }, content: [p('水壶')] },
      { type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex: 'x^2 + y^2 = r^2' } }] },
    ] });
    for (const id of ['heading', 'callout', 'disclosure', 'formula']) expect(practiceTaskSatisfied(id, editor.state), id).toBe(true);
    editor.commands.setContent({ type: 'doc', content: [{ ...p('周末公园观察'), type: 'heading', attrs: { level: 1 } },
      { type: 'githubAlert', content: [{ type: 'paragraph' }] }, { type: 'disclosure', attrs: { title: '装备清单' }, content: [{ type: 'paragraph' }] }, p('x^2+y^2=r^2')] });
    for (const id of ['heading', 'callout', 'disclosure', 'formula']) expect(practiceTaskSatisfied(id, editor.state), id).toBe(false);
  });
  it('requires headers and a filled observation row, then the document table style', () => {
    const table = { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('项目')] }, { type: 'tableHeader', content: [p('记录')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p('天气')] }, { type: 'tableCell', content: [p('晴')] }] },
    ] };
    const editor = make({ type: 'doc', content: [table] });
    expect(practiceTaskSatisfied('table', editor.state)).toBe(true); expect(practiceTaskSatisfied('table-style', editor.state)).toBe(false);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'documentPresentation', attrs: { tableStyle: 'three-line' } }, table] });
    expect(practiceTaskSatisfied('table-style', editor.state)).toBe(true);
    table.content[1].content[1].content = [p('')]; editor.commands.setContent({ type: 'doc', content: [table] });
    expect(practiceTaskSatisfied('table', editor.state)).toBe(false);
  });
  it('requires a saved nonempty explanation connected to the target', () => {
    const body = (text: string) => ({ type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note' }, content: [p(text)] }] });
    const editor = make({ type: 'doc', content: [p(PRACTICE_WORD), body('说明')] });
    expect(practiceTaskSatisfied('annotation', editor.state)).toBe(false);
    editor.commands.setContent({ type: 'doc', content: [{ ...p(PRACTICE_WORD), attrs: { annotationId: 'note' } }, body('')] });
    expect(practiceTaskSatisfied('annotation', editor.state)).toBe(false);
    editor.commands.setContent({ type: 'doc', content: [{ ...p(PRACTICE_WORD), attrs: { annotationId: 'note' } }, body('观察让人留意身边')] });
    expect(practiceTaskSatisfied('annotation', editor.state)).toBe(true);
    editor.commands.setContent({ type: 'doc', content: [p(PRACTICE_WORD), body('说明')] });
    const range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to - 1, editor.schema.marks.annotationReference.create({ id: 'note' })));
    expect(practiceTaskSatisfied('annotation', editor.state)).toBe(false);
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.annotationReference.create({ id: 'note' })));
    expect(practiceTaskSatisfied('annotation', editor.state)).toBe(true);
    editor.commands.setContent({ type: 'doc', content: [p('其他文字'), body(PRACTICE_WORD)] });
    expect(findPracticeText(editor.state.doc, PRACTICE_WORD)).toBeNull();
  });
  it('accepts moving the full block and rejects merely duplicating it', () => {
    const editor = make({ type: 'doc', content: [p(ACTION_BLOCK), p(OBSERVATION_BLOCK)] });
    expect(practiceTaskSatisfied('move', editor.state)).toBe(true);
    editor.commands.setContent({ type: 'doc', content: [p(ACTION_BLOCK), p(OBSERVATION_BLOCK), p(ACTION_BLOCK)] });
    expect(practiceTaskSatisfied('move', editor.state)).toBe(false);
  });
});

describe('practice editor observation', () => {
  it('never reads an unrelated editor and ignores invalidated ownership and cleanup', () => {
    const foreign = { isDestroyed: false, get state() { throw Error('unrelated document was read'); } } as unknown as Editor;
    expect(() => observePracticeTask({ editor: foreign, activeKey: 'other', sessionKey: 'practice', stepId: 'selection', current: () => true, onComplete: vi.fn() })()).not.toThrow();
    const editor = make(), done = vi.fn(), range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
    let current = true;
    const stop = observePracticeTask({ editor, activeKey: 'practice', sessionKey: 'practice', stepId: 'selection', current: () => current, onComplete: done });
    current = false; editor.commands.setTextSelection(range); expect(done).not.toHaveBeenCalled();
    stop(); current = true; editor.commands.setTextSelection(1); editor.commands.setTextSelection(range); expect(done).not.toHaveBeenCalled();
  });
  it('latches completion without changing selection or advancing a task', () => {
    const editor = make(), done = vi.fn(), range = findPracticeText(editor.state.doc, PRACTICE_WORD)!;
    const stop = observePracticeTask({ editor, activeKey: 'practice', sessionKey: 'practice', stepId: 'selection', current: () => true, onComplete: done });
    editor.commands.setTextSelection(range); expect(done).toHaveBeenCalledTimes(1); expect(editor.state.selection.from).toBe(range.from);
    editor.commands.setTextSelection(1); editor.commands.setTextSelection(range); expect(done).toHaveBeenCalledTimes(1); stop();
  });
  it('checks a new edit, actual undo and actual redo, rejecting manual recreation', () => {
    const editor = make({ type: 'doc', content: [p('原文')] }), done = vi.fn(), progress = vi.fn();
    initializeDocumentHistory('practice', serializeEditorDocument(editor), 'visual');
    const unregister = registerDocumentHistoryAdapter('practice', { applyEntry: entry => parseEditorDocument(editor, entry.content, 'history') });
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged && !isApplyingDocumentHistory('practice')) recordDocumentChange('practice', serializeEditorDocument(editor), { mode: 'visual', startsNewGroup: true });
    });
    const stop = observePracticeTask({ editor, activeKey: 'practice', sessionKey: 'practice', stepId: 'history', current: () => true, onComplete: done, onHistoryProgress: progress });
    editor.commands.insertContent('新'); expect(undoDocumentHistory('practice')).toBe(true);
    expect(progress).toHaveBeenCalledWith(true); expect(done).not.toHaveBeenCalled();
    editor.commands.insertContent('新'); expect(done).not.toHaveBeenCalled();
    expect(undoDocumentHistory('practice')).toBe(true); expect(redoDocumentHistory('practice')).toBe(true);
    expect(done).toHaveBeenCalledTimes(1); stop(); unregister();
  });
  it('releases listeners when the editor is destroyed', () => {
    const editor = make(), off = vi.spyOn(editor, 'off'), done = vi.fn();
    const stop = observePracticeTask({ editor, activeKey: 'practice', sessionKey: 'practice', stepId: 'selection', current: () => true, onComplete: done });
    editor.destroy(); expect(off).toHaveBeenCalledWith('transaction', expect.any(Function)); stop(); expect(done).not.toHaveBeenCalled();
  });
});
