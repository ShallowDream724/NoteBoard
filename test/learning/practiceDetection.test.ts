import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { decodeNativeDocument, encodeNativeDocument } from '../../src/core/nativeDocument';
import { initializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { GUIDE_DISCLOSURE, GUIDE_STEPS, GUIDE_WORD } from '../../src/features/learning/practiceCourse';
import showcase from '../../src/features/welcome/showcase.nb?raw';
import { findPracticeText, guideBlankPosition, guideCalloutCount, guideTaskSatisfied, ownsPracticeEditor } from '../../src/features/learning/practiceDetection';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: JSONContent = { type: 'doc', content: [p(GUIDE_WORD)] }, key = 'showcase') {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content });
  initializeEditorDocument(editor, encodeNativeDocument(content), 'noteboard', '', key);
  editors.push(editor); return editor;
}
const body = (id: string, text: string): JSONContent => ({ type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id }, content: [p(text)] }] });
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));

describe('showcase guide semantic outcomes', () => {
  it('starts the actual shipped sample with no semantic task already passed', () => {
    const editor = make(decodeNativeDocument(showcase) as JSONContent), baseline = guideCalloutCount(editor.state.doc);
    expect(baseline).toBeGreaterThan(0); expect(findPracticeText(editor.state.doc, GUIDE_WORD)).not.toBeNull();
    for (const step of GUIDE_STEPS) expect(guideTaskSatisfied(step.id, editor.state, baseline), step.id).toBe(false);
  });
  it('requires the full visible phrase selected and highlighted', () => {
    const editor = make(), range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
    for (const [from, to] of [[range.from, range.to - 1], [range.from + 1, range.to], [range.from, range.from]]) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
      expect(guideTaskSatisfied('selection', editor.state, 0)).toBe(false);
    }
    editor.commands.setTextSelection(range);
    expect(guideTaskSatisfied('selection', editor.state, 0)).toBe(true);
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to - 1, editor.schema.marks.highlight.create()));
    expect(guideTaskSatisfied('highlight', editor.state, 0)).toBe(false);
    editor.view.dispatch(editor.state.tr.addMark(range.to - 1, range.to, editor.schema.marks.highlight.create({ color: '#ff0000' })));
    expect(guideTaskSatisfied('highlight', editor.state, 0)).toBe(true);
  });
  it('requires a saved body linked to all target letters, rather than an unrelated body or draft reference', () => {
    const editor = make({ type: 'doc', content: [p(GUIDE_WORD), body('note', '说明')] });
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(false);
    const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to - 1, editor.schema.marks.annotationReference.create({ id: 'note' })));
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(false);
    editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, editor.schema.marks.annotationReference.create({ id: 'draft' })));
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(false);
  });
  it.each(['记下这个想法', '   ', ''])('accepts a saved explanation with body %j and also recognizes a fast save during the opening step', text => {
    const linked: JSONContent = { ...p(GUIDE_WORD), content: [{ type: 'text', text: GUIDE_WORD, marks: [{ type: 'annotationReference', attrs: { id: 'note' } }] }] };
    const editor = make({ type: 'doc', content: [linked, body('note', text)] });
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(true);
    expect(guideTaskSatisfied('annotation-open', editor.state, 0)).toBe(true);
  });
  it('does not count an unsaved draft as an opened or saved explanation', () => {
    const linked: JSONContent = { ...p(GUIDE_WORD), content: [{ type: 'text', text: GUIDE_WORD, marks: [{ type: 'annotationReference', attrs: { id: 'draft' } }] }] };
    const editor = make({ type: 'doc', content: [linked] });
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(false);
    expect(guideTaskSatisfied('annotation-open', editor.state, 0)).toBe(false);
  });
  it('also accepts a saved explanation on the target block', () => {
    const editor = make({ type: 'doc', content: [{ ...p(GUIDE_WORD), attrs: { annotationId: 'block' } }, body('block', '说明')] });
    expect(guideTaskSatisfied('annotation-save', editor.state, 0)).toBe(true);
  });
  it('ignores hidden annotation text and preserves positions through inline atoms and split marks', () => {
    const editor = make({ type: 'doc', content: [body('hidden', GUIDE_WORD), { type: 'paragraph', content: [
      { type: 'text', text: '前' }, { type: 'mathInline', attrs: { latex: 'x' } },
      { type: 'text', text: GUIDE_WORD.slice(0, 3), marks: [{ type: 'bold' }] }, { type: 'text', text: GUIDE_WORD.slice(3) },
    ] }] });
    const range = findPracticeText(editor.state.doc, GUIDE_WORD)!;
    expect(editor.state.doc.textBetween(range.from, range.to)).toBe(GUIDE_WORD);
    expect(findPracticeText(make({ type: 'doc', content: [p('别的文字'), body('hidden', GUIDE_WORD)] }).state.doc, GUIDE_WORD)).toBeNull();
  });
  it('counts only newly inserted visible callouts and the intended opened disclosure', () => {
    const alert: JSONContent = { type: 'githubAlert', content: [p('已有提示')] };
    const editor = make({ type: 'doc', content: [alert, { type: 'disclosure', attrs: { title: GUIDE_DISCLOSURE, open: false }, content: [p('水壶')] }] });
    const baseline = guideCalloutCount(editor.state.doc);
    expect(baseline).toBe(1); expect(guideTaskSatisfied('insert-callout', editor.state, baseline)).toBe(false);
    editor.commands.insertContentAt(editor.state.doc.content.size, alert);
    expect(guideTaskSatisfied('insert-callout', editor.state, baseline)).toBe(true);
    expect(guideTaskSatisfied('disclosure', editor.state, baseline)).toBe(false);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'disclosure', attrs: { title: '别的清单', open: true }, content: [p('水壶')] }] });
    expect(guideTaskSatisfied('disclosure', editor.state, baseline)).toBe(false);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'disclosure', attrs: { title: GUIDE_DISCLOSURE, open: true }, content: [p('水壶')] }] });
    expect(guideTaskSatisfied('disclosure', editor.state, baseline)).toBe(true);
  });
  it('locates a top-level empty line or current slash query', () => {
    const editor = make({ type: 'doc', content: [{ type: 'githubAlert', content: [p('')] }, p('正文'), p('/note'), p('')] });
    let position = 0; editor.state.doc.forEach((node, pos) => { if (node.textContent === '/note') position = pos; });
    expect(guideBlankPosition(editor.state.doc)).toBe(position);
    expect(guideBlankPosition(make({ type: 'doc', content: [p('正文')] }).state.doc)).toBeNull();
  });
  it('prefers the current eligible top-level line and falls back when the caret is elsewhere', () => {
    const editor = make({ type: 'doc', content: [p(''), p('正文'), p('/no'), p('')] });
    const query = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    const last = query + editor.state.doc.child(2).nodeSize;
    expect(guideBlankPosition(editor.state.doc, query + 4)).toBe(query);
    expect(guideBlankPosition(editor.state.doc, last + 1)).toBe(last);
    expect(guideBlankPosition(editor.state.doc, 4)).toBe(0);
  });
  it('does not treat nested paragraphs or slash text mixed with an inline atom as a command line', () => {
    const editor = make({ type: 'doc', content: [{ type: 'githubAlert', content: [p('')] }, { type: 'paragraph', content: [
      { type: 'text', text: '/no' }, { type: 'mathInline', attrs: { latex: 'x' } },
    ] }, p('')] });
    const blank = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    expect(guideBlankPosition(editor.state.doc, 2)).toBe(blank);
    expect(guideBlankPosition(editor.state.doc, blank - 2)).toBe(blank);
  });
  it('rejects missing, destroyed and foreign editor identities without reading their content', () => {
    const foreign = { isDestroyed: false, get state() { throw Error('foreign document read'); } } as unknown as Editor;
    expect(ownsPracticeEditor(foreign, 'showcase')).toBe(false);
    const editor = make(); expect(ownsPracticeEditor(editor, 'showcase')).toBe(true);
    expect(ownsPracticeEditor(editor, 'other')).toBe(false); expect(ownsPracticeEditor(null, 'showcase')).toBe(false);
    editor.destroy(); expect(ownsPracticeEditor(editor, 'showcase')).toBe(false);
  });
});
