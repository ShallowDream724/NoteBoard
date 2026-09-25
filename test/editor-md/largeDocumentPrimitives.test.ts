import { describe, expect, it, vi } from 'vitest';
import { Node as PMNode, Fragment } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { tableEditing } from '@tiptap/pm/tables';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { headingSectionEnd } from '@/features/editor-md/headingFolding';

const schema = documentParser().schema;
const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));

describe('large immutable document operations', () => {
  it.each([10, 128, 10000])('resolves content boundaries and range text in a %i-block document', count => {
    const children = Array.from({ length: count }, (_, i) => paragraph('text-' + i + (i % 7 ? '' : ' longer')));
    const doc = schema.nodes.doc.create(null, children);
    let pos = 0;
    for (const child of children) {
      expect(doc.nodeAt(pos)).toBe(child);
      expect(doc.resolve(pos + 1).parent).toBe(child);
      expect(doc.textBetween(pos + 1, pos + child.nodeSize - 1)).toBe(child.textContent);
      pos += child.nodeSize;
    }
    const changed = doc.copy(doc.content.replaceChild(1, paragraph('replacement with a different size')));
    expect(changed.lastChild).toBe(doc.lastChild);
    expect(changed.nodeAt(changed.content.size - changed.lastChild!.nodeSize)).toBe(doc.lastChild);
    expect(doc.nodeAt(doc.content.size - doc.lastChild!.nodeSize)).toBe(doc.lastChild);
  });

  it('keeps table validation work linear when every row receives a height', () => {
    const row = schema.nodes.tableRow.create(null, [schema.nodes.tableCell.create(null, paragraph('value'))]);
    const count = 1000, table = schema.nodes.table.create(null, Array(count).fill(row));
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, table), plugins: [tableEditing()] });
    const changed = table.copy(Fragment.fromArray(Array.from({ length: count }, () => row.type.create({ ...row.attrs, height: 50 }, row.content))));
    const read = vi.spyOn(PMNode.prototype, 'child');
    try {
      const next = state.applyTransaction(state.tr.replaceWith(0, table.nodeSize, changed)).state;
      expect(next.doc.firstChild!.lastChild!.attrs.height).toBe(50);
      expect(read.mock.calls.length).toBeLessThan(count * 50);
      next.doc.check();
    } finally { read.mockRestore(); }
  });

  it('finds nested heading boundaries without counting a table as thousands of outline blocks', () => {
    const heading = (level: number) => schema.nodes.heading.create({ level }, schema.text('heading'));
    const children = Array.from({ length: 500 }, () => paragraph('body'));
    const doc = schema.nodes.doc.create(null, [heading(1), heading(2), ...children, heading(2), heading(1)]);
    const h2 = doc.firstChild!.nodeSize, nextH1 = doc.content.size - doc.lastChild!.nodeSize;
    expect(headingSectionEnd(doc, 0)).toBe(nextH1);
    expect(headingSectionEnd(doc, h2)).toBe(nextH1 - doc.child(doc.childCount - 2).nodeSize);
  });
});
