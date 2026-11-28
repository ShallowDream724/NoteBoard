import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import type { LanguageId } from '../../src/core/ipc/types';
import { codeJumpHistory, createCodeNavigation } from '../../src/features/editor-code/codeNavigation';
import { collectCodeSymbols } from '../../src/features/editor-code/codeSymbols';

describe('code navigation', () => {
  it.each<[LanguageId, string, string[]]>([
    ['typescript', '// function fake() {}\nexport function run() {}\nconst render: Fn = () => {};\nclass Editor { getName() {} }\ntype Name = string;', ['run', 'render', 'Editor', 'getName', 'Name']],
    ['python', '"""\ndef fake(): ...\n"""\nclass Exam:\n    async def test(self): pass\n', ['Exam', 'test']],
    ['cpp', 'struct Frame {};\nint *next() { return nullptr; }\nvoid Frame::open() {}', ['Frame', 'next', 'Frame::open']],
    ['matlab', '%{\nfunction fake()\n%}\nfunction [x, y] = signal(a)\nend\nclassdef (Sealed) Filter\nend', ['signal', 'Filter']],
    ['json', '{"name":"root","group":{"mode":"up"}}', ['name', 'group', 'mode']],
    ['yaml', 'name: root\ngroup:\n  "mode": up\n# fake: key', ['name', 'group', 'mode']],
    ['toml', '[name.group] # note\n[[products]]\nname = "sample"', ['name.group', 'products']],
    ['ini', '; [fake]\n[group]\n[service] ; comment\nmode=up', ['group', 'service']],
    ['html', '<!-- <p id="fake"> --><div data-id="ignored" ID=main></div>\n<h2\n id="next">Next</h2>', ['main', 'next']],
    ['xml', '<document xml:id="title"><body id="next"/></document>', ['title', 'next']],
  ])('collects real %s declaration names at their source lines', async (language, doc, labels) => {
    const { symbols, limited } = await collectCodeSymbols(EditorState.create({ doc }), language);
    expect(symbols.map(({ label }) => label)).toEqual(labels);
    expect(limited).toBe(false);
    for (const { label, position, line } of symbols) {
      expect(doc.slice(position).replace(/^["']/, '').startsWith(label)).toBe(true);
      expect(line).toBe(doc.slice(0, position).split('\n').length);
    }
  });

  it('indexes current edits, rejects stale targets, and maps the original selection through edits', async () => {
    const doc = '/* current work */\nfunction original() {}\n';
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: 3, head: 10 }, extensions: [codeJumpHistory] }) });
    try {
      const navigation = createCodeNavigation(view, () => 'javascript');
      const before = await navigation.readSymbols();
      view.dispatch({ changes: { from: doc.length, insert: 'function unsaved() {}\n' } });
      expect(before.jump(before.symbols[0])).toBe(false);

      const index = await navigation.readSymbols();
      expect(await navigation.readSymbols()).toBe(index);
      const target = index.symbols.find(({ label }) => label === 'unsaved')!;
      expect(target.line).toBe(3);
      expect(index.jump(target)).toBe(true);
      expect(view.state.selection.main.head).toBe(target.position);
      expect(index.jump(target)).toBe(true);

      view.dispatch({ changes: { from: 0, insert: '//\n' } });
      expect(navigation.returnToPrevious()).toBe(true);
      expect(view.state.selection.main.anchor).toBe(6);
      expect(view.state.selection.main.head).toBe(13);
      expect(navigation.canReturn()).toBe(false);
    } finally {
      view.destroy();
    }
  });

  it('limits both scanned input and the number of indexed targets', async () => {
    const manySections = Array.from({ length: 1_005 }, (_, i) => `[section${i}]`).join('\n');
    const many = await collectCodeSymbols(EditorState.create({ doc: manySections }), 'ini');
    expect(many.limited).toBe(true);
    expect(many.symbols).toHaveLength(1_000);
    const largeFile = '[first]\n;' + ' '.repeat(120_000) + '\n[last]';
    const large = await collectCodeSymbols(EditorState.create({ doc: largeFile }), 'ini');
    expect(large.limited).toBe(true);
    expect(large.symbols.map(({ label }) => label)).toEqual(['first']);
  });
});
