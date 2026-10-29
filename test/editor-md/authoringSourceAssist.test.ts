import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { authoringCompletionSource } from '@/features/editor-md/authoringSourceAssist';

async function complete(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  return await authoringCompletionSource(new CompletionContext(state, doc.length, true));
}
describe('declarative source assistance', () => {
  it('offers block and inline commands and the selected block parameters', async () => {
    expect((await complete('::: fo'))?.options.some(option => option.label === 'fold')).toBe(true);
    expect((await complete('text \\co'))?.options.some(option => option.label === 'color')).toBe(true);
    expect((await complete('::: pic wi'))?.options.some(option => option.label === 'width' && option.apply === 'width=')).toBe(true);
  });
  it('keeps command completion out of opaque code', async () => {
    expect(await complete('```\n\\co')).toBeNull();
  });
});
