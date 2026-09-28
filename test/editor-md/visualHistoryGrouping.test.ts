import { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { VisualHistoryGrouping, changesDocumentStructure } from '@/features/editor-md/visualHistoryGrouping';
import { discreteTransaction } from '@/features/editor-md/discreteEdit';

describe('shared visual history boundaries', () => {
  it('isolates structure on both sides while ignoring selection and view transactions', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>Before</p>' });
    try {
      const groups = new VisualHistoryGrouping();
      const body = editor.state.tr.insertText(' text', 7); editor.view.dispatch(body);
      expect(groups.startsNewGroup(body, false)).toBe(false);
      const creation = editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.codeBlock.create()); editor.view.dispatch(creation);
      expect(groups.startsNewGroup(creation, false)).toBe(true);
      expect(groups.startsNewGroup(editor.state.tr.setMeta('fold-view', true).setMeta('addToHistory', false), false)).toBe(false);
      const input = editor.state.tr.insertText('a', body.doc.content.size + 1); editor.view.dispatch(input);
      expect(groups.startsNewGroup(input, false)).toBe(true);
      expect(groups.startsNewGroup(editor.state.tr.insertText('b', body.doc.content.size + 2), false)).toBe(false);
    } finally { editor.destroy(); }
  });

  it('leaves normal paragraph splits and long code typing under native timing', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>text</p>' });
    try {
      expect(changesDocumentStructure(editor.state.tr.split(3))).toBe(false);
      editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x'.repeat(100_000) }] }] });
      const scan = vi.spyOn(editor.state.doc, 'descendants');
      expect(changesDocumentStructure(editor.state.tr.insertText('y', 50_000))).toBe(false);
      expect(scan).not.toHaveBeenCalled();
    } finally { editor.destroy(); }
  });

  it('distinguishes atom source edits from atom creation and honors explicit action boundaries', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'a' } }] } });
    try {
      expect(changesDocumentStructure(editor.state.tr.setNodeMarkup(0, undefined, { latex: 'ab' }))).toBe(false);
      expect(changesDocumentStructure(editor.state.tr.delete(0, 1))).toBe(true);
      const groups = new VisualHistoryGrouping();
      expect(groups.startsNewGroup(discreteTransaction(editor.state.tr.setNodeAttribute(0, 'latex', 'changed')), false)).toBe(true);
      expect(groups.startsNewGroup(editor.state.tr.setNodeAttribute(0, 'latex', 'again'), false)).toBe(true);
      expect(groups.startsNewGroup(editor.state.tr.setNodeAttribute(0, 'latex', 'typing'), false)).toBe(false);
    } finally { editor.destroy(); }
  });
});
