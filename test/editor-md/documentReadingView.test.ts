// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { DocumentReadingView, documentFormulaReadingMode, documentReadingViewKey, setDocumentFormulaReadingMode,
  setTableReadingMode, tableReadingMode } from '../../src/features/editor-md/documentReadingView';

function create() {
  const cell = { type: 'tableCell', content: [{ type: 'paragraph' }] };
  return new Editor({ extensions: [...buildDocumentExtensions(), DocumentReadingView], content: {
    type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'a+b', delimiter: '$$' } },
      { type: 'mathBlock', attrs: { latex: 'x+y', delimiter: '$$' } },
      ...[0, 1].map(() => ({ type: 'table', content: [{ type: 'tableRow', content: [cell, cell] }] })),
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
        expect(documentReadingViewKey.getState(editor.state)?.tables.find()).toHaveLength(0);
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
  it('keeps table overrides local and mapped through edits independently of formulas', () => {
    const editor = create();
    try {
      const [first, second] = tablePositions(editor);
      setTableReadingMode(editor, first, 'scroll');
      setDocumentFormulaReadingMode(editor, 'wrap');
      expect(tableReadingMode(editor.state, first)).toBe('scroll');
      expect(tableReadingMode(editor.state, second)).toBe('expand');
      editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: '前言' }] });
      const [movedFirst, movedSecond] = tablePositions(editor);
      expect(tableReadingMode(editor.state, movedFirst)).toBe('scroll');
      expect(tableReadingMode(editor.state, movedSecond)).toBe('expand');
      expect(documentFormulaReadingMode(editor.state)).toBe('wrap');
      setTableReadingMode(editor, movedFirst, 'expand');
      expect(documentReadingViewKey.getState(editor.state)?.tables.find()).toHaveLength(0);
    } finally { editor.destroy(); }
  });
  it('does not change another open document or dispatch for an unchanged policy', () => {
    const first = create(), second = create();
    try {
      let transactions = 0;
      first.on('transaction', () => transactions++);
      setDocumentFormulaReadingMode(first, 'scroll');
      setDocumentFormulaReadingMode(first, 'scroll');
      expect(transactions).toBe(1);
      expect(documentFormulaReadingMode(second.state)).toBe('expand');
      expect(second.view.dom.dataset.formulaReading).toBe('expand');
    } finally { first.destroy(); second.destroy(); }
  });
});
