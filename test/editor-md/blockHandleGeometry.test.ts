import { Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';
import { blockHandlePosition } from '@/features/editor-md/blockHandleGeometry';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' } } });
const bounds = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
function geometry(scale: number, paragraphTop: number, paragraphHeight: number, text = '') {
  const host = document.createElement('div'), element = document.createElement('p');
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

  it('retains the top alignment for content blocks', () => {
    expect(geometry(2, 84, 90, 'Content').top).toBe(50 + 84 + 2);
  });
});
