// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { MarkdownTable } from '@/features/editor-md/markdownTable';
import { EfficientTableView } from '@/features/editor-md/tableView';
import { AnnotationBehavior, annotationIndexKey } from '@/features/editor-md/annotations/extension';
import { addAnnotation, removeAnnotation } from '@/features/editor-md/annotations/commands';
import { annotationAnchors } from '@/features/editor-md/annotations/model';
import annotationCss from '@/features/editor-md/annotations/annotations.css?raw';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const body = [paragraph('One shared explanation')];
function create(content: JSONContent[]) {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({ element, extensions: [...buildDocumentExtensions({ table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), AnnotationBehavior], content: { type: 'doc', content } });
  editors.push(editor); return nativeTestEditor(editor);
}
function annotateAll(editor: Editor) {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  return addAnnotation(editor, body, { open: false })!;
}
function indicators(editor: Editor, id: string) { return editor.view.dom.querySelectorAll(`.nb-annotation-indicator[data-annotation-id="${id}"]`); }
afterEach(() => { editors.splice(0).forEach(editor => { editor.view.dom.parentElement?.remove(); editor.destroy(); }); document.querySelectorAll('style[data-annotation-test]').forEach(style => style.remove()); });

describe('annotation presentation groups', () => {
  it('keeps one marker at the end of a continuous multi-paragraph selection without merging stored anchors', () => {
    const editor = create([paragraph('First'), paragraph('Second'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Last', marks: [{ type: 'bold' }] }] }]);
    const initial = editor.state.doc, id = annotateAll(editor);
    expect(annotationAnchors(editor.state.doc).filter(anchor => anchor.id === id)).toHaveLength(3);
    expect(indicators(editor, id)).toHaveLength(1);
    expect(indicators(editor, id)[0].closest('h2')?.textContent).toBe('Last?');
    expect(editor.view.dom.querySelectorAll('.nb-annotation-short-anchor')).toHaveLength(0);
    expect(annotationIndexKey.getState(editor.state)?.groupCounts.get(id)).toBe(1);
    const annotated = editor.state.doc;
    expect(removeAnnotation(editor, id)).toBe(true);
    expect(editor.state.doc.eq(initial)).toBe(true);
    editor.commands.undo(); expect(editor.state.doc.eq(annotated)).toBe(true);
    expect(indicators(editor, id)).toHaveLength(1);
  });

  it('counts Unicode code points and updates the short underline when typing crosses the limit', () => {
    const editor = create([paragraph('😀'.repeat(100))]), id = annotateAll(editor);
    expect(editor.view.dom.querySelectorAll('.nb-annotation-short-anchor')).toHaveLength(1);
    let anchor = annotationAnchors(editor.state.doc)[0];
    editor.view.dispatch(editor.state.tr.insertText('a', anchor.from + 2));
    expect(editor.view.dom.querySelectorAll('.nb-annotation-short-anchor')).toHaveLength(0);
    expect(indicators(editor, id)).toHaveLength(1);
    anchor = annotationAnchors(editor.state.doc)[0];
    editor.view.dispatch(editor.state.tr.delete(anchor.from + 2, anchor.from + 3));
    expect(editor.view.dom.querySelectorAll('.nb-annotation-short-anchor')).toHaveLength(1);
  });

  it('does not underline whole-block notes or long text, while separated references retain individual entrances', () => {
    const whole = create([paragraph('A whole paragraph')]);
    whole.commands.setNodeSelection(0); const blockId = addAnnotation(whole, body, { open: false })!;
    expect(indicators(whole, blockId)).toHaveLength(1);
    expect(whole.view.dom.querySelector('.nb-annotation-short-anchor')).toBeNull();
    const long = create([paragraph('中'.repeat(101))]); annotateAll(long);
    expect(long.view.dom.querySelector('.nb-annotation-short-anchor')).toBeNull();
    const editor = create([paragraph('First'), paragraph('Last')]), id = annotateAll(editor);
    const last = annotationAnchors(editor.state.doc).at(-1)!;
    editor.view.dispatch(editor.state.tr.insert(last.from - 1, editor.schema.nodes.paragraph.create(null, editor.schema.text('Independent text'))));
    expect(indicators(editor, id)).toHaveLength(2);
    expect(annotationIndexKey.getState(editor.state)?.groupCounts.get(id)).toBe(2);
    editor.commands.undo();
    expect(indicators(editor, id)).toHaveLength(1);
    expect(annotationIndexKey.getState(editor.state)?.groupCounts.get(id)).toBe(1);
  });

  it('keeps a table between selected paragraphs in one presentation group', () => {
    const editor = create([paragraph('Before'), { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [paragraph('A')] }, { type: 'tableCell', content: [paragraph('B')] },
    ] }] }, paragraph('After')]);
    const id = annotateAll(editor);
    expect(annotationAnchors(editor.state.doc).filter(anchor => anchor.id === id)).toHaveLength(4);
    expect(indicators(editor, id)).toHaveLength(1);
    expect(indicators(editor, id)[0].closest('p')?.textContent).toBe('After?');
    expect(editor.view.dom.querySelectorAll('.nb-annotation-short-anchor')).toHaveLength(0);
  });

  it('updates a reused table marker when its shared-note group splits and rejoins', () => {
    const id = 'table_shared';
    const editor = create([{ type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id }, content: body }] },
      { type: 'table', attrs: { annotationId: id }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('A')] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After', marks: [{ type: 'annotationReference', attrs: { id } }] }] },
    ]);
    const style = document.createElement('style'); style.dataset.annotationTest = ''; style.textContent = annotationCss; document.head.append(style);
    const anchors = annotationAnchors(editor.state.doc), tableNode = editor.state.doc.nodeAt(anchors[0].from);
    const tableDOM = editor.view.nodeDOM(anchors[0].from) as HTMLElement;
    const marker = tableDOM.querySelector<HTMLElement>('.nb-table-annotation-indicator')!;
    expect(tableDOM.dataset.annotationMarker).toBe('hidden');
    expect(getComputedStyle(marker).display).toBe('none');
    editor.view.dispatch(editor.state.tr.insert(anchors[0].to, editor.schema.nodes.paragraph.create(null, editor.schema.text('Separate'))));
    expect(editor.state.doc.nodeAt(anchors[0].from)).toBe(tableNode);
    expect(editor.view.nodeDOM(anchors[0].from)).toBe(tableDOM);
    expect(tableDOM.dataset.annotationMarker).toBe('visible');
    expect(getComputedStyle(marker).display).not.toBe('none');
    expect(tableNode?.attrs.annotationId).toBe(id);
    editor.commands.undo();
    expect(tableDOM.dataset.annotationMarker).toBe('hidden');
    expect(getComputedStyle(marker).display).toBe('none');
  });
});
