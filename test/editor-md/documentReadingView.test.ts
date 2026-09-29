// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { DocumentReadingView, documentFormulaReadingMode, documentReadingViewKey, documentTableReadingMode,
  setDocumentFormulaReadingMode, setDocumentTableReadingMode } from '../../src/features/editor-md/documentReadingView';

const table: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [0, 1].map(() => ({
  type: 'tableCell', content: [{ type: 'paragraph' }],
})) }] };

function create() {
  return new Editor({ extensions: [...buildDocumentExtensions(), DocumentReadingView], content: {
    type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'a+b', delimiter: '$$' } },
      { type: 'mathBlock', attrs: { latex: 'x+y', delimiter: '$$' } },
      table, table,
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
    ],
  } });
}
function tablePositions(editor: Editor) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'table') positions.push(pos); });
  return positions;
}

describe('document reading view', () => {
  it('uses one formula policy without editing, recreating or decorating each formula', () => {
    const editor = create();
    try {
      const document = editor.state.doc, html = editor.getHTML();
      const nodes = [editor.view.nodeDOM(0), editor.view.nodeDOM(1)];
      for (const mode of ['wrap', 'scroll', 'expand'] as const) {
        expect(setDocumentFormulaReadingMode(editor, mode)).toBe(true);
        expect(editor.view.dom.dataset.formulaReading).toBe(mode);
        expect(editor.state.doc).toBe(document);
        expect([editor.view.nodeDOM(0), editor.view.nodeDOM(1)]).toEqual(nodes);
        expect(editor.getHTML()).toBe(html);
      }
      expect(editor.commands.undo()).toBe(false);
    } finally { editor.destroy(); }
  });
  it('retains the policy for newly inserted formulas and after plugin reconfiguration and undo', () => {
    const editor = create();
    try {
      setDocumentFormulaReadingMode(editor, 'wrap');
      editor.registerPlugin(new Plugin({}));
      const position = editor.state.doc.content.size;
      editor.commands.insertContentAt(position, { type: 'mathBlock', attrs: { latex: 'new', delimiter: '$$' } });
      expect(editor.view.dom.dataset.formulaReading).toBe('wrap');
      expect(editor.state.doc.nodeAt(position)?.attrs.latex).toBe('new');
      expect(editor.commands.undo()).toBe(true);
      expect(documentFormulaReadingMode(editor.state)).toBe('wrap');
      expect(editor.commands.redo()).toBe(true);
      expect(editor.state.doc.nodeAt(position)?.attrs.latex).toBe('new');
      expect(editor.view.dom.dataset.formulaReading).toBe('wrap');
    } finally { editor.destroy(); }
  });
  it('applies one table policy without changing the document, selection, node views or history', () => {
    const editor = create();
    try {
      const document = editor.state.doc, selection = editor.state.selection, html = editor.getHTML();
      const nodes = tablePositions(editor).map(pos => editor.view.nodeDOM(pos));
      const changes: { documentChanged: boolean; addToHistory: unknown }[] = [];
      editor.on('transaction', ({ transaction }) => changes.push({
        documentChanged: transaction.docChanged, addToHistory: transaction.getMeta('addToHistory'),
      }));
      setDocumentFormulaReadingMode(editor, 'wrap');
      for (const mode of ['scroll', 'expand'] as const) {
        expect(setDocumentTableReadingMode(editor, mode)).toBe(true);
        expect(documentTableReadingMode(editor.state)).toBe(mode);
        expect(editor.view.dom.dataset.tableReading).toBe(mode);
        expect(editor.state.doc).toBe(document);
        expect(editor.state.selection).toBe(selection);
        expect(tablePositions(editor).map(pos => editor.view.nodeDOM(pos))).toEqual(nodes);
        expect(editor.getHTML()).toBe(html);
        expect(documentFormulaReadingMode(editor.state)).toBe('wrap');
      }
      expect(changes).toEqual(Array.from({ length: 3 }, () => ({ documentChanged: false, addToHistory: false })));
      expect(editor.commands.undo()).toBe(false);
    } finally { editor.destroy(); }
  });
  it('lets existing and new tables inherit the policy through edits, reconfiguration, undo and redo', () => {
    const editor = create();
    try {
      setDocumentTableReadingMode(editor, 'scroll');
      setDocumentFormulaReadingMode(editor, 'wrap');
      editor.registerPlugin(new Plugin({}));
      const position = editor.state.doc.content.size;
      editor.commands.insertContentAt(position, table);
      expect(tablePositions(editor)).toHaveLength(3);
      expect(editor.view.dom.dataset.tableReading).toBe('scroll');
      expect(documentTableReadingMode(editor.state)).toBe('scroll');
      expect(editor.commands.undo()).toBe(true);
      expect(tablePositions(editor)).toHaveLength(2);
      expect(documentTableReadingMode(editor.state)).toBe('scroll');
      expect(editor.commands.redo()).toBe(true);
      expect(tablePositions(editor)).toHaveLength(3);
      editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: '前言' }] });
      expect(documentTableReadingMode(editor.state)).toBe('scroll');
      expect(editor.view.dom.dataset.tableReading).toBe('scroll');
      expect(documentFormulaReadingMode(editor.state)).toBe('wrap');
      expect(documentReadingViewKey.getState(editor.state)).toEqual({ formula: 'wrap', table: 'scroll' });
    } finally { editor.destroy(); }
  });
  it('does not change another open document or dispatch for an unchanged policy', () => {
    const first = create(), second = create();
    try {
      let transactions = 0;
      first.on('transaction', () => transactions++);
      setDocumentFormulaReadingMode(first, 'scroll');
      setDocumentFormulaReadingMode(first, 'scroll');
      setDocumentTableReadingMode(first, 'scroll');
      setDocumentTableReadingMode(first, 'scroll');
      expect(transactions).toBe(2);
      expect(documentFormulaReadingMode(second.state)).toBe('expand');
      expect(documentTableReadingMode(second.state)).toBe('expand');
      expect(second.view.dom.dataset.formulaReading).toBe('expand');
      expect(second.view.dom.dataset.tableReading).toBe('expand');
    } finally { first.destroy(); second.destroy(); }
  });
});
