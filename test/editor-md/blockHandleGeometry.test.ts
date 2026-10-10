import { Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it, vi } from 'vitest';
import { blockHandlePosition } from '@/features/editor-md/blockHandleGeometry';
import { releaseListMarkerGeometry } from '@/features/editor-md/listMarkerGeometry';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' } } });
const bounds = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
function geometry(scale: number, paragraphTop: number, paragraphHeight: number, text = '') {
  const host = document.createElement('div'), element = document.createElement('p');
  element.style.lineHeight = '34px';
  host.getBoundingClientRect = () => bounds(20, 100, 600 * scale, 400 * scale);
  Object.defineProperties(host, { offsetWidth: { value: 600 }, clientHeight: { value: 400 } });
  host.scrollTop = 50;
  element.getBoundingClientRect = () => bounds(100, 100 + paragraphTop * scale, 480 * scale, paragraphHeight * scale);
  const node = schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
  return blockHandlePosition({} as EditorView, { element, pos: 0, node }, host, 30, 30);
}

describe('block handle geometry', () => {
  it.each([1, 2])('centers the empty paragraph control in its range at %sx scale', scale => {
    for (const height of [27, 42]) {
      const position = geometry(scale, 84, height);
      expect(position.top + 15).toBe(50 + 84 + height / 2);
    }
  });

  it('keeps controls reachable when a block extends past either viewport edge', () => {
    expect(geometry(2, -20, 27).top).toBe(50);
    expect(geometry(2, 395, 27).top).toBe(50 + 400 - 30 - 4);
    expect(geometry(2, -300, 900, 'Long content').top).toBe(50);
  });

  it('centers on the first text line of tall content blocks', () => {
    expect(geometry(2, 84, 90, 'Content').top).toBe(50 + 84 + 2);
  });

  it.each([1, 1.25, 2])('aligns a short paragraph and its control at %sx scale', scale => {
    const position = geometry(scale, 84, 27, 'after');
    expect(position.top + 15).toBe(50 + 84 + 27 / 2);
  });

  it.each([[31, 15], [76, 528]])('keeps a wide-counter handle outside the row at measured width %s', (glyphWidth, expectedLeft) => {
    const lists = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' },
      orderedList: { content: 'listItem+', group: 'block', attrs: { start: { default: 1 } } }, listItem: { content: 'paragraph+' }, text: { group: 'inline' } } });
    const doc = lists.nodes.doc.create(null, lists.nodes.orderedList.create({ start: 123456 }, lists.nodes.listItem.create(null, lists.nodes.paragraph.create(null, lists.text('one')))));
    const view = { state: { doc } } as unknown as EditorView;
    const host = document.createElement('div'), list = document.createElement('ol'), item = list.appendChild(document.createElement('li'));
    host.append(list); host.getBoundingClientRect = () => bounds(0, 100, 600, 400);
    Object.defineProperties(host, { offsetWidth: { value: 600 }, clientWidth: { value: 600 }, clientHeight: { value: 400 } });
    list.getBoundingClientRect = () => bounds(64, 190, 456, 100); item.getBoundingClientRect = () => bounds(88, 200, 432, 26);
    Object.assign(item.style, { fontSize: '16px', listStyleType: 'decimal' });
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: () => ({ width: glyphWidth }) } as unknown as CanvasRenderingContext2D);
    try {
      const position = blockHandlePosition(view, { element: item, pos: 1, node: doc.firstChild!.firstChild! }, host);
      expect(position.width).toBe(30); expect(position.left).toBe(expectedLeft);
    } finally { releaseListMarkerGeometry(view); spy.mockRestore(); }
  });
});
