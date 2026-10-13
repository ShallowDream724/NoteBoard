// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Step } from '@tiptap/pm/transform';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';
import { columnWidthsStep, resizedColumnWidth, resizedColumnPair } from '../../src/features/editor-md/tableColumnWidths';

describe('table column gestures', () => {
  it('resizes one column without borrowing width from a neighbour', () => {
    expect(resizedColumnWidth(500, -120)).toBe(380);
    expect(resizedColumnWidth(500, 300)).toBe(800);
    expect(resizedColumnWidth(100, 120)).toBe(220);
    expect(resizedColumnWidth(80, -100)).toBe(40);
    expect(resizedColumnWidth(80, 20000)).toBe(10000);
  });
  it('keeps imported narrow widths stable until the user grows them', () => {
    expect(resizedColumnWidth(10, 1)).toBe(11);
    expect(resizedColumnWidth(10, -20)).toBe(10);
    expect(resizedColumnWidth(10, 50)).toBe(60);
  });
  it('optionally exchanges adjacent widths while keeping the outer boundary free', () => {
    expect(resizedColumnPair([80, 500, 100], 1, -120)).toEqual([380, 220]);
    expect(resizedColumnPair([80, 500, 100], 1, 300)).toEqual([560, 40]);
    expect(resizedColumnPair([80, 500, 100], 2, 120)).toEqual([220, undefined]);
    expect(resizedColumnPair([10, 10], 0, 1)).toEqual([10, 10]);
    expect(resizedColumnPair([10, 500], 0, 4)).toEqual([14, 496]);
    expect(resizedColumnPair([10000, 10000], 0, -500)).toEqual([10000, 10000]);
  });
  it('commits one attribute step, preserves text/selection/DOM and supports undo/redo', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    parseMarkdown(editor, '| A | B |\n| --- | --- |\n| one | two |');
    try {
      const before = editor.state.doc, table = before.firstChild!;
      editor.commands.setTextSelection(4);
      const selection = editor.state.selection.toJSON(), paragraphs = [...editor.view.dom.querySelectorAll('p')];
      const tr = editor.state.tr.step(columnWidthsStep(0, table, [120, 240]));
      expect(tr.steps).toHaveLength(1); expect(tr.mapping.map(8)).toBe(8);
      editor.view.dispatch(tr);
      expect(editor.state.doc.textContent).toBe(before.textContent);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      paragraphs.forEach((p, i) => expect(editor.view.dom.querySelectorAll('p')[i]).toBe(p));
      expect(serializeMarkdown(editor)).toContain('"widths":[120,240]');
      expect(Step.fromJSON(editor.schema, tr.steps[0].toJSON()).apply(before).doc?.eq(editor.state.doc)).toBe(true);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
      editor.commands.redo(); expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([120]);
    } finally { editor.destroy(); }
  });
  it('preserves row/column spans and restores exact prior automatic widths', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    parseMarkdown(editor, '<table><tr><th colspan="2">Header</th></tr><tr><td rowspan="2">ID</td><td>A</td></tr><tr><td>B</td></tr></table>');
    try {
      const before = editor.state.doc, step = columnWidthsStep(0, before.firstChild!, [110, 220]);
      const next = step.apply(before).doc!;
      expect(next.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([110, 220]);
      expect(next.firstChild?.lastChild?.firstChild?.attrs.colwidth).toEqual([220]);
      expect(step.invert(before).apply(next).doc?.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
});
