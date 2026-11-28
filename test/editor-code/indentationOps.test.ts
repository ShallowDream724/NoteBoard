import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';
import type { LanguageId } from '../../src/core/ipc/types';
import { createIndentationOps } from '../../src/features/editor-code/indentationOps';

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(doc: string, language: LanguageId, extension: Extension = [], readonly = false) {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [EditorState.tabSize.of(4), extension] }) });
  views.push(view);
  return { view, ops: createIndentationOps(view, () => language, () => true, () => readonly) };
}

it('writes only nonblank leading indentation and preserves tab stops and multiline literals', async () => {
  const source = 'const s = `\n\t  template\n`;\nif (ready) {\n \t  call("  x"); \t\n\t\n}\n';
  const { view, ops } = editor(source, 'javascript', javascript());
  expect(await ops.convert(true)).toBe('changed');
  expect(view.state.doc.toString()).toBe(source.replace(' \t  call', '      call'));
  expect(await ops.convert(false)).toBe('changed');
  expect(view.state.doc.toString()).toBe(source.replace(' \t  call', '\t  call'));
  expect(await ops.convert(false)).toBe('unchanged');
});

it('detects indentation from the current text outside multiline data and keeps the width for tabs', async () => {
  const source = 's = """\n    keep\n      keep\n        keep\n"""\nif True:\n\tprint(1)\n';
  const tabs = editor(source, 'python', python());
  await expect(tabs.ops.detect()).resolves.toEqual({ insertSpaces: false });
  expect(tabs.view.state.doc.toString()).toBe(source);

  const spaces = editor('first\n   second\n      third\n   fourth\n         fifth', 'plaintext');
  await expect(spaces.ops.detect()).resolves.toEqual({ insertSpaces: true, tabSize: 3 });
  const mixed = editor('first\n\tsecond\n  third', 'plaintext');
  await expect(mixed.ops.detect()).resolves.toBeNull();
});

it('does not modify a read-only document or fall back to text when a code grammar is required', async () => {
  const readonly = editor('first\n\tsecond', 'plaintext', [], true);
  await expect(readonly.ops.convert(true)).resolves.toBe('unavailable');
  const noGrammar = editor('if (ready) {\n\tcall();\n}', 'javascript');
  await expect(noGrammar.ops.convert(true)).resolves.toBe('syntax-unavailable');
});

it('preserves the content of folded YAML scalars during conversion', async () => {
  const source = 'text: >\n    first line\n      indented text\ngroup:\n    child: value';
  const { view, ops } = editor(source, 'yaml', yaml());
  await expect(ops.convert(false)).resolves.toBe('changed');
  expect(view.state.doc.toString()).toBe(source.replace('    child', '\tchild'));
});

it('discards an in-flight conversion when the source changes before dispatch', async () => {
  const { view, ops } = editor('first\n\tsecond', 'plaintext');
  const conversion = ops.convert(true);
  view.dispatch({ changes: { from: 0, insert: 'earlier\n' } });
  await expect(conversion).resolves.toBe('unavailable');
  expect(view.state.doc.toString()).toBe('earlier\nfirst\n\tsecond');
});
