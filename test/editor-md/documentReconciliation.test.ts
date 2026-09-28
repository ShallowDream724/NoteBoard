import { Editor, type JSONContent } from '@tiptap/core';
import { expect, it } from 'vitest';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { reconcileDocumentHistory } from '../../src/features/editor-md/documentReconciliation';
import { parseMarkdown, serializeMarkdown, withEditableTail } from '../../src/features/editor-md/serialize';

const p = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const examples: JSONContent[][] = [
  [p('aaaa')], [p('aaa')], [p('')],
  [{ ...p('aaa'), attrs: { blockBackground: '#eff6ff' } }],
  [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold' }] }, { type: 'text', text: 'aa' }] }],
  [{ type: 'blockquote', content: [p('aaa'), p('nested')] }],
  [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('aaa')] }, { type: 'listItem', content: [p('nested')] }] }],
  [{ type: 'mathBlock', attrs: { latex: 'x^2', textAlign: 'right' } }, p('tail')],
  [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: '#eff6ff' }, content: [p('cell')] }] }] }],
];

it('reconciles content, marks, block attributes and nesting with exact target structure', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions() });
  try {
    for (const content of examples) {
      const target = withEditableTail(editor, editor.schema.nodeFromJSON({ type: 'doc', content }));
      for (const previous of examples) {
        editor.commands.setContent({ type: 'doc', content: previous });
        reconcileDocumentHistory(editor, target);
        expect(editor.state.doc.toJSON(), JSON.stringify({ previous, content })).toEqual(target.toJSON());
        const retained = editor.state.doc;
        reconcileDocumentHistory(editor, target);
        expect(editor.state.doc).toBe(retained);
      }
    }
  } finally { editor.destroy(); }
});

it('shares incremental restoration with Markdown history and keeps unchanged code nodes', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions() });
  try {
    const before = 'Before $a$ after\n\n```python\ndef greet():\n    return 1\n```';
    parseMarkdown(editor, before);
    const baseline = serializeMarkdown(editor);
    const code = editor.state.doc.child(1);
    parseMarkdown(editor, before.replace('$a$', ''), 'history');
    expect(editor.state.doc.child(1)).toBe(code);
    parseMarkdown(editor, before, 'history');
    expect(editor.state.doc.child(1)).toBe(code);
    expect(serializeMarkdown(editor)).toBe(baseline);
  } finally { editor.destroy(); }
});
