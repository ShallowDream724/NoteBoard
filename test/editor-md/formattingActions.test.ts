import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { buildDocumentExtensions, documentParser } from '@/features/editor-md/documentExtensions';
import { sourceFormattingGrammar } from '@/features/editor-md/sourceFormattingGrammar';
import { clearSourceTextFormatting, restoreSourceParagraph, runSourceFormatCommand } from '@/features/editor-md/sourceFormatting';
import { clearSelectionTextFormatting, clearTextStyleMarks } from '@/features/editor-md/textFormatting';
import { getMarkdownManager, serializeMarkdownFromDoc } from '@/features/editor-md/serialize';

const editors: Editor[] = [], views: EditorView[] = [];
function visual(content: string) {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
}
function source(doc: string, anchor = 0, head = anchor) {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: sourceFormattingGrammar }), history()] }) });
  views.push(view); return view;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); for (const view of views.splice(0)) view.destroy(); });

it('keeps links and list structure when clearing styles, with an independent undo', () => {
  const editor = visual('<ol start="7"><li><p><a href="https://example.com"><b>one</b></a></p></li><li><p><i>two</i></p></li></ol><p>after</p>');
  editor.commands.setTextSelection({ from: 3, to: 6 }); const before = editor.state.doc;
  expect(clearSelectionTextFormatting(editor)).toBe(true);
  expect(editor.state.doc.firstChild!.type.name).toBe('orderedList'); expect(editor.state.doc.firstChild!.attrs.start).toBe(7);
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
  expect(editor.state.doc.firstChild!.lastChild).toBe(before.firstChild!.lastChild);
  editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('restores only the current list item to paragraph and retains its hyperlink and bold mark', () => {
  const editor = visual('<ul><li><p>one</p></li><li><p><a href="https://example.com"><b>two</b></a></p></li><li><p>three</p></li></ul><p>after</p>');
  let pos = 0; editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'two') pos = at + 1; });
  editor.commands.setTextSelection(pos); const before = editor.state.doc;
  expect(editor.commands.restoreParagraph()).toBe(true);
  expect(editor.state.doc.content.content.map(node => [node.type.name, node.textContent])).toEqual([['bulletList', 'one'], ['paragraph', 'two'], ['bulletList', 'three'], ['paragraph', 'after']]);
  expect(editor.state.doc.child(1).firstChild!.marks.map(mark => mark.type.name).sort()).toEqual(['bold', 'link']);
  editor.state.doc.check(); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
});

it('restores a selected quote paragraph without flattening its unselected neighbor or media', () => {
  const editor = visual('<blockquote><p><b>one</b></p><p>two</p></blockquote><p>after</p>');
  editor.commands.setTextSelection(3);
  expect(editor.commands.restoreParagraph()).toBe(true);
  expect(editor.state.doc.content.content.map(node => [node.type.name, node.textContent])).toEqual([['paragraph', 'one'], ['blockquote', 'two'], ['paragraph', 'after']]);
  expect(editor.state.doc.firstChild!.firstChild!.marks[0].type.name).toBe('bold'); editor.state.doc.check();
});

it('slash clearing uses the shared style whitelist rather than removing link marks', () => {
  const editor = visual('<p><a href="https://example.com"><b>words/clear</b></a></p><p>after</p>');
  editor.commands.setTextSelection(12);
  expect(editor.chain().deleteRange({ from: 6, to: 12 }).command(({ tr }) => { clearTextStyleMarks(tr); return true; }).run()).toBe(true);
  expect(editor.state.doc.firstChild!.textContent).toBe('words');
  expect(editor.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
});

it('source clearing keeps lists, links, images, math, escaped markers and fenced code verbatim', () => {
  const doc = '- [**中文**](https://example.com/a_b?x=**keep**) 与 ~~字~~ ++线++ `x_y` $a_b$ ![图](a_b.png) \\*literal\\*\n\n```txt\n**keep**\n```';
  const view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('- [中文](https://example.com/a_b?x=**keep**) 与 字 线 x\\_y $a_b$ ![图](a_b.png) \\*literal\\*\n\n```txt\n**keep**\n```');
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it('source clear acts on the current line while restore strips only selected line structure', () => {
  const doc = '- **one**\n- **two**\n- **three**', view = source(doc, 14);
  expect(clearSourceTextFormatting(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('- **one**\n- two\n- **three**');
  expect(restoreSourceParagraph(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('- **one**\ntwo\n- **three**');
});

it('source restore does not consume the next row at a selection end boundary', () => {
  const doc = '- one\n1. two\n> three', view = source(doc, 0, 6);
  expect(restoreSourceParagraph(view)).toBe(true); expect(view.state.doc.toString()).toBe('one\n1. two\n> three');
});

it('partial source clearing cannot leave an unmatched delimiter and source restore preserves literal code lines', () => {
  const view = source('**word**', 0, 4);
  expect(clearSourceTextFormatting(view)).toBe(false); expect(view.state.doc.toString()).toBe('**word**');
  const code = source('```md\n# literal\n- literal\n```', 6, 25);
  expect(restoreSourceParagraph(code)).toBe(false); expect(code.state.doc.toString()).toBe('```md\n# literal\n- literal\n```');
});

it.each(['**literal**', '[name](https://example.com)', '$x+y$', '<b>word</b>', '++under++', '# heading', '- item', '1. item', '\\[x\\]', '\\(x\\)', '    code'])('clearing inline code preserves literal content: %s', body => {
  const doc = '`' + body + '`', view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  const parsed = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  expect(parsed.childCount, JSON.stringify({ source: view.state.doc.toString(), parsed: parsed.toJSON() })).toBe(1); expect(parsed.firstChild!.type.name).toBe('paragraph'); expect(parsed.textContent).toBe(body);
  expect(parsed.firstChild!.childCount).toBe(1); expect(parsed.firstChild!.firstChild!.marks).toHaveLength(0);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['# title', '- item', '> quote', '1. item', '---', '```js', '~~~'])('clearing emphasis does not expose new block syntax: %s', body => {
  const doc = '**' + body + '**', view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  const parsed = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  expect(parsed.firstChild!.type.name).toBe('paragraph'); expect(parsed.textContent).toBe(body);
  expect(parsed.firstChild!.firstChild!.marks).toHaveLength(0);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['- **# title**', '> **- item**', '- x\n  **# title**', '> x\n> **# title**'])('retains existing structure while preventing new inner block syntax: %s', doc => {
  const before = documentParser().schema.nodeFromJSON(documentParser().manager.parse(doc)), view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  const after = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  const types = (root: typeof before) => { const result: string[] = []; root.descendants(node => { if (!node.isText) result.push(node.type.name); }); return result; };
  expect(types(after)).toEqual(types(before)); expect(after.textContent).toBe(before.textContent);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['# title', '1. item', '> [!NOTE]', '    code'])('clearing HTML style tags preserves plain paragraph meaning: %s', body => {
  const doc = '<b>' + body + '</b>', view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  const after = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  expect(after.childCount).toBe(1); expect(after.firstChild!.type.name).toBe('paragraph'); expect(after.textContent).toBe(body);
  expect(after.firstChild!.firstChild!.marks).toHaveLength(0);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['title\n**===**', '> **[!NOTE]**\n> body', 'a | b\n**--- | ---**', '[**link**](https://example.com) | b\n**--- | ---**', '- outer\n  - title\n    **===**', '- outer\n  - middle\n    - title\n      **===**', '- outer\n  - a | b\n    **--- | ---**', '- outer\n  - middle\n    - a | b\n      **--- | ---**', '- outer\n  - > **[!NOTE]**\n    > body'])('preserves contextual block ownership while clearing styles: %s', doc => {
  const before = documentParser().schema.nodeFromJSON(documentParser().manager.parse(doc)), view = source(doc, 0, doc.length);
  expect(clearSourceTextFormatting(view)).toBe(true);
  const after = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  const types = (root: typeof before) => { const result: string[] = []; root.descendants(node => { if (!node.isText) result.push(node.type.name); }); return result; };
  expect(types(after)).toEqual(types(before)); expect(after.textContent).toBe(before.textContent);
  const links: string[] = []; after.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'link') links.push(mark.attrs.href); });
  if (doc.includes('https:')) expect(links).toEqual(['https://example.com']);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['**$$x$$**', '**\\[x\\]**', '**\\[\nx % comment\ny\n\\]**', '> **\\[\n> x % comment\n> y\n> \\]**', '- **\\[\n  x % comment\n  y\n  \\]**'])('keeps an existing inline formula and its exact TeX when removing surrounding marks: %s', doc => {
  const before = documentParser().schema.nodeFromJSON(documentParser().manager.parse(doc)), view = source(doc, 0, doc.length);
  const formulas = (root: typeof before) => { const nodes: { type: string; latex: string }[] = []; root.descendants(node => { if (node.type.name.startsWith('math')) nodes.push({ type: node.type.name, latex: node.attrs.latex }); }); return nodes; };
  expect(formulas(before)).toHaveLength(1); expect(formulas(before)[0].type).toBe('mathInline');
  expect(clearSourceTextFormatting(view)).toBe(true);
  const after = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  expect(after.firstChild!.type.name).toBe(before.firstChild!.type.name); expect(formulas(after)).toEqual(formulas(before));
  after.descendants(node => { if (node.type.name === 'mathInline') expect(node.marks).toHaveLength(0); });
  const editor = visual('');
  const saved = serializeMarkdownFromDoc(getMarkdownManager(editor)!, editor.schema, after);
  const reloaded = documentParser().schema.nodeFromJSON(documentParser().manager.parse(saved));
  expect(reloaded.eq(after)).toBe(true); expect(formulas(reloaded)).toEqual(formulas(before));
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});

it.each(['$$', '\\['] as const)('saving an inline %s formula at a paragraph boundary preserves its delimiter and links', delimiter => {
  const parser = documentParser(), doc = parser.schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex: 'x + y', delimiter } }, { type: 'text', text: ' ' }, { type: 'text', text: 'linked', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'next' }] },
  ] });
  const editor = visual('');
  const saved = serializeMarkdownFromDoc(getMarkdownManager(editor)!, editor.schema, doc), reloaded = parser.schema.nodeFromJSON(parser.manager.parse(saved));
  expect(reloaded.toJSON()).toEqual(doc.toJSON());
});

it('requires both HTML style tags in the selected range before removing them', () => {
  const doc = '前 <b>word</b> 后', partial = source(doc, 2, 5);
  expect(clearSourceTextFormatting(partial)).toBe(false); expect(partial.state.doc.toString()).toBe(doc);
  const complete = source(doc, 2, 13);
  expect(clearSourceTextFormatting(complete)).toBe(true); expect(complete.state.doc.toString()).toBe('前 word 后');
  expect(undo(complete)).toBe(true); expect(complete.state.doc.toString()).toBe(doc);
});

it('toggling code off uses the same literal-preserving path for multiple backtick fences and a partial caret selection', () => {
  const doc = '``[name](https://example.com)``', view = source(doc, 5);
  expect(runSourceFormatCommand(view, 'markdown.code')).toBe(true);
  const parsed = documentParser().schema.nodeFromJSON(documentParser().manager.parse(view.state.doc.toString()));
  expect(parsed.textContent).toBe('[name](https://example.com)'); expect(parsed.firstChild!.firstChild!.marks).toHaveLength(0);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(doc);
});
