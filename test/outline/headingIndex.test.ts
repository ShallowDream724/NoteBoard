import { describe, expect, it, vi } from 'vitest';
import { Schema, type Node } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { HeadingIndex } from '../../src/features/outline/headingIndex';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'text*' },
  heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
  blockquote: { group: 'block', content: 'block+' },
  text: {},
} });
const p = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const h = (text: string) => schema.node('heading', null, text ? schema.text(text) : undefined);
const expected = (doc: Node) => {
  const result: { text: string; pos: number; level: number }[] = [];
  doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.textContent) result.push({ text: node.textContent, pos, level: node.attrs.level }); });
  return result;
};
const comparable = (index: HeadingIndex) => index.items.map(({ text, pos, level }) => ({ text, pos, level }));

describe('incremental heading ownership', () => {
  it('preserves IDs across preceding edits, heading renames, attribute changes and splits', () => {
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [p('body'), h('First'), h('Second')]) });
    const index = new HeadingIndex(state.doc);
    const ids = index.items.map(item => item.id);
    const apply = (tr: ReturnType<typeof state.tr.insertText>) => {
      index.apply(tr); state = state.apply(tr);
      expect(comparable(index)).toEqual(expected(state.doc));
    };
    apply(state.tr.insertText('longer ', 1));
    expect(index.items.map(item => item.id)).toEqual(ids);
    const first = index.items[0].pos;
    apply(state.tr.insertText('New', first + 1, first + 6));
    expect(index.items[0].id).toBe(ids[0]);
    apply(state.tr.setNodeMarkup(first, undefined, { level: 3 }));
    expect(index.items[0].id).toBe(ids[0]);
    apply(state.tr.split(first + 2));
    expect(new Set(index.items.map(item => item.id)).size).toBe(index.items.length);
    expect(index.items.at(-1)?.id).toBe(ids[1]);
  });

  it('handles touched block boundaries, nested headings, deletion and empty headings', () => {
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [p('x'), h('A'), schema.node('blockquote', null, [h('B')]), h('')]) });
    const index = new HeadingIndex(state.doc);
    for (const edit of [
      () => state.tr.insertText('tail', 2),
      () => state.tr.insertText('Filled', state.doc.content.size - 1),
      () => state.tr.delete(index.items[0].pos, index.items[0].pos + state.doc.nodeAt(index.items[0].pos)!.nodeSize),
      () => state.tr.insertText('', index.items[0].pos + 1, index.items[0].pos + 2),
    ]) {
      const tr = edit(); index.apply(tr); state = state.apply(tr);
      expect(comparable(index)).toEqual(expected(state.doc));
    }
  });

  it('does not walk document siblings or changed-range descendants for ordinary focused typing', () => {
    const doc = schema.node('doc', null, [h('Start'), ...Array.from({ length: 5000 }, () => p('body')), h('End')]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, doc.content.size - 2) });
    const index = new HeadingIndex(doc);
    const tr = state.tr.insertText('x');
    // Resolve before the probe, as the editor must already do to display its selection.
    void tr.selection;
    const visit = vi.spyOn(tr.doc, 'nodesBetween');
    index.apply(tr);
    expect(visit).not.toHaveBeenCalled();
    expect(index.items.at(-1)?.text).toBe('Enxd');
    visit.mockRestore();
  });
});
