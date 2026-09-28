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
  [p('abca')], [p('aXYa')], [p('中文标点，替换。')],
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

it.each([
  { node: { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)' }] }, attr: 'language', value: 'javascript' },
  { node: { type: 'disclosure', attrs: { title: 'Before' }, content: [p('body')] }, attr: 'title', value: 'After' },
  { node: examples[8][0], attr: 'caption', value: 'Details' },
])('restores $node.type metadata without replacing its contents or moving its caret', ({ node, attr, value }) => {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [node, p('tail')] } });
  try {
    const original = editor.state.doc.firstChild!;
    const selection = editor.state.selection;
    const json = editor.getJSON(); json.content![0].attrs = { ...json.content![0].attrs, [attr]: value };
    let remapped = false;
    editor.on('transaction', ({ transaction }) => transaction.mapping.maps.forEach(map => map.forEach(() => { remapped = true; })));
    reconcileDocumentHistory(editor, editor.schema.nodeFromJSON(json));
    expect(editor.state.doc.firstChild!.attrs[attr]).toBe(value);
    expect(editor.state.doc.firstChild!.content).toBe(original.content);
    expect(editor.state.selection.eq(selection)).toBe(true);
    expect(remapped).toBe(false);
  } finally { editor.destroy(); }
});
