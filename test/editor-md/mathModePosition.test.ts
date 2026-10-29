import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { mapModeSelection } from '@/features/editor-md/sourcePosition';
import { markdownMathPayload, markdownMathSelection } from '@/features/editor-md/mathModePosition';

describe('formula mode caret transfer', () => {
  it.each(['x+y', '\\frac{a}{b}'])('preserves the internal selection of the second identical formula: %s', latex => {
    const source = `$${latex}$ and $${latex}$`, { schema, manager } = documentParser();
    const doc = schema.nodeFromJSON(manager.parse(source));
    const editor = { state: { doc }, storage: { markdown: { manager } } } as unknown as Editor;
    const positions: number[] = [];
    doc.descendants((node, position) => { if (node.type.name === 'mathInline') positions.push(position); });
    const payload = markdownMathPayload(editor, source, positions[1]);
    expect(payload).toEqual({ from: source.lastIndexOf(latex), to: source.lastIndexOf(latex) + latex.length });
    const selection = { anchor: payload!.from + 2, head: payload!.from + 1 };
    const visual = mapModeSelection(editor, source, 'visual', selection);
    expect(markdownMathSelection(editor, source, selection, visual)).toEqual({ position: positions[1], anchor: 2, head: 1 });
  });
});
