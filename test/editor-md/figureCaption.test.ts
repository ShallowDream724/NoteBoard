// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTable } from '../../src/features/editor-md/markdownTable';
import { EfficientTableView } from '../../src/features/editor-md/tableView';
import { TableRowLayout } from '../../src/features/editor-md/tableRowLayout';
import { AnnotationBehavior } from '../../src/features/editor-md/annotations/extension';
import { ANNOTATION_BEGIN_EVENT, addAnnotation, beginBlockAnnotation, type AnnotationBeginRequest } from '../../src/features/editor-md/annotations/commands';
import { resolveAnnotationTarget } from '../../src/features/editor-md/annotations/draftTarget';
import { annotationAnchors } from '../../src/features/editor-md/annotations/model';
import { editFigureCaption, setFigureCaption } from '../../src/features/editor-md/figureCaptionCommands';
import { BlockMetadataStep } from '../../src/features/editor-md/blockMetadataStep';
import { DocumentCapabilityGuard, transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { portableMarkdown } from '../../src/features/export/portableMarkdown';
import { renderDocument } from '../../src/features/export/renderDocument';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { moveTopLevelBlock } from '../../src/features/editor-md/blockReorder';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
function create(native = true) {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({ element, editorProps: { handleScrollToSelection: () => true }, extensions: [...buildDocumentExtensions({ table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), AnnotationBehavior, DocumentCapabilityGuard],
    content: '<table><tr><th colwidth="80">A</th><th colwidth="120">B</th></tr><tr><td colwidth="80">C</td><td colwidth="120">D</td></tr></table><p>tail</p>' });
  editors.push(editor); return native ? nativeTestEditor(editor) : editor;
}
afterEach(() => { editors.splice(0).forEach(editor => { editor.view.dom.parentElement?.remove(); editor.destroy(); }); vi.restoreAllMocks(); });

describe('whole-table notes and figure captions', () => {
  it('captures a table block while cells are selected and renders its marker on the actual table', () => {
    const editor = create(), table = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 2, 2 + table.firstChild!.firstChild!.nodeSize)));
    const selected = editor.state.selection;
    let request: AnnotationBeginRequest | undefined;
    editor.view.dom.addEventListener(ANNOTATION_BEGIN_EVENT, event => { request = (event as CustomEvent<AnnotationBeginRequest>).detail; });
    const id = beginBlockAnnotation(editor, 0)!;
    expect(editor.state.selection.eq(selected)).toBe(true);
    const selection = resolveAnnotationTarget(request!.target, editor.state.doc)!;
    const layout = vi.spyOn(TableRowLayout.prototype, 'update');
    expect(addAnnotation(editor, [{ type: 'paragraph', content: [{ type: 'text', text: 'Whole table' }] }], { id, selection, open: false })).toBe(id);
    const anchors = annotationAnchors(editor.state.doc);
    expect(anchors).toHaveLength(1); expect(anchors[0].block).toBe(true);
    expect(editor.state.doc.nodeAt(anchors[0].from)?.type.name).toBe('table');
    expect(editor.state.doc.nodeAt(anchors[0].from)?.content).toBe(table.content);
    expect(layout).not.toHaveBeenCalled();
    const dom = editor.view.nodeDOM(anchors[0].from) as HTMLElement;
    expect(dom.querySelector('table > caption .nb-table-annotation-indicator')?.getAttribute('data-annotation-id')).toBe(id);
    expect(dom.querySelector('td .nb-annotation-indicator')).toBeNull();
    expect(dom.querySelector('.nb-annotation-block-marker')).toBeNull();
    expect(dom.classList.contains('nb-annotation-anchor')).toBe(false);
  });

  it('edits, cancels, removes and undoes a table caption without touching rows or selection', () => {
    const editor = create(), before = editor.state.doc.firstChild!, selection = editor.state.selection;
    const layout = vi.spyOn(TableRowLayout.prototype, 'update');
    expect(editFigureCaption(editor, 0)).toBe(true);
    const input = editor.view.dom.querySelector<HTMLTextAreaElement>('.nb-table-caption-input')!;
    expect(input.closest('table')!.lastElementChild).toBe(input.parentElement);
    expect(input.hidden).toBe(false); expect(document.activeElement).toBe(input);
    input.value = '  Table details\nSecond line  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.state.doc.firstChild!.attrs.caption).toBe('Table details\nSecond line');
    expect(editor.state.doc.firstChild!.content).toBe(before.content);
    expect(editor.state.selection.eq(selection)).toBe(true); expect(layout).not.toHaveBeenCalled();
    editFigureCaption(editor, 0); input.value = 'discard'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.state.doc.firstChild!.attrs.caption).toBe('Table details\nSecond line');
    editFigureCaption(editor, 0); input.value = ''; input.dispatchEvent(new FocusEvent('blur'));
    expect(editor.state.doc.firstChild!.attrs.caption).toBeNull();
    editor.commands.undo(); expect(editor.state.doc.firstChild!.attrs.caption).toBe('Table details\nSecond line');
    editor.commands.undo(); expect(editor.state.doc.firstChild!.eq(before)).toBe(true);
  });

  it('keeps native captions on moved tables and preserves text in Markdown, HTML, print and Pandoc', async () => {
    const editor = create();
    setFigureCaption(editor.view, 0, 'Results <safe>\nSecond line');
    const original = editor.state.doc;
    const moved = moveTopLevelBlock(editor.view, 0, original.content.size)!;
    expect(editor.state.doc.nodeAt(moved.insertedPos)!.attrs.caption).toBe('Results <safe>\nSecond line');
    editor.commands.undo(); expect(editor.state.doc.eq(original)).toBe(true);
    expect(parseNativeNode(serializeNativeNode(original), editor.schema).eq(original)).toBe(true);
    const markdown = portableMarkdown(editor.getJSON());
    expect(markdown.indexOf('Results')).toBeGreaterThan(markdown.indexOf('| C | D |'));
    expect(markdown).toContain('Second line'); expect(markdown).not.toContain('noteboard-table');
    for (const mode of ['html', 'print'] as const) {
      const result = await renderDocument('', 'caption', '', undefined, editor.state.doc, undefined, undefined, mode);
      const host = document.createElement('div'); host.innerHTML = result.html;
      expect(host.querySelector('table > caption')?.textContent).toBe('Results <safe>\nSecond line');
      expect(host.querySelector('safe')).toBeNull(); expect(host.querySelector('table')?.style.width).toBe('200px');
    }
    const ast = JSON.parse(pandocSource(editor.state.doc));
    expect(ast.blocks[0].t).toBe('Table'); expect(JSON.stringify(ast.blocks[0].c[1])).toContain('Second');
    const restored = new Editor({ extensions: buildDocumentExtensions(), content: editor.getHTML() }); editors.push(restored);
    expect(restored.state.doc.firstChild!.attrs.caption).toBe('Results <safe>\nSecond line');
  });

  it('gates caption changes in Markdown and preserves invalid native caption source', async () => {
    const editor = create(false), before = editor.state.doc;
    expect(editFigureCaption(editor, 0)).toBe(false);
    const tr = editor.state.tr.step(new BlockMetadataStep(0, 'caption', 'requires native'));
    expect(transactionAddedCapability(tr)).toBe('figureCaption');
    editor.view.dispatch(tr); await Promise.resolve(); expect(editor.state.doc).toBe(before);
    const bad = serializeNativeNode(before).replace('"type":"table"', '"type":"table","attrs":{"caption":7}');
    const recovered = parseNativeNode(bad, editor.schema);
    expect(recovered.firstChild!.type.name).toBe('nativeError'); expect(serializeNativeNode(recovered)).toBe(bad);
  });
});
