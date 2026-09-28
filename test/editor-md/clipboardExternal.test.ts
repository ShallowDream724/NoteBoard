import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { DOMParser as WorkerDOMParser } from 'linkedom';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { initializeEditorDocument, serializeEditorDocument, type RichDocumentFormat } from '../../src/features/editor-md/editorDocumentCodec';
import { NATIVE_DOCUMENT_HEADER } from '../../src/core/nativeDocument';
import { ClipboardImport, DOCUMENT_SLICE_MIME, importClipboardSnapshot } from '../../src/features/editor-md/clipboard/clipboardImport';
import { clipboardHtmlSource, needsClipboardImageFallback, normalizeExternalHtml, normalizeExternalText } from '../../src/features/editor-md/clipboard/external';
import { handlePastedImageFiles } from '../../src/features/editor-md/imagePaste';

vi.mock('../../src/features/editor-md/imagePaste', () => ({ handlePastedImageFiles: vi.fn() }));
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.clearAllMocks(); });
function create(format: RichDocumentFormat = 'markdown', content = '<p>target</p>') {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), ClipboardImport.configure({ docKey: `test.${format}` })], content });
  initializeEditorDocument(editor, format === 'noteboard' ? `${NATIVE_DOCUMENT_HEADER}\n` : '', format);
  editors.push(editor); editor.commands.selectAll(); return editor;
}
function paste(editor: Editor, formats: Record<string, string>, plain = false, files?: File[]) {
  expect(importClipboardSnapshot(editor.view, { formats, files }, plain)).toBe(true);
  editor.state.doc.check();
}
function normalizedHtml(html: string, plain?: string) {
  return normalizeExternalHtml(new DOMParser().parseFromString(clipboardHtmlSource(html), 'text/html'), html, plain, { inferMarkdown: true });
}

describe.each<RichDocumentFormat>(['noteboard', 'markdown'])('%s external clipboard', format => {
  it('parses external Markdown headings, math, lists, fences and tables with one undo', () => {
    const editor = create(format);
    const source = '# 222\n\n### 333\n\n$a$ is \\(b\\)\n\n- first\n- second\n\n```js\nconst n = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    paste(editor, { 'text/plain': source });
    const json = editor.getJSON();
    expect(json.content?.slice(0, 6).map(node => node.type)).toEqual(['heading', 'heading', 'paragraph', 'bulletList', 'codeBlock', 'table']);
    expect(json.content?.[0].attrs?.level).toBe(1); expect(json.content?.[1].attrs?.level).toBe(3);
    expect(json.content?.[2].content?.filter(node => node.type === 'mathInline').map(node => 'attrs' in node ? node.attrs?.latex : undefined)).toEqual(['a', 'b']);
    const saved = serializeEditorDocument(editor);
    if (format === 'markdown') { expect(saved).toContain('# 222'); expect(saved).toContain('$a$ is \\(b\\)'); expect(saved).not.toContain('\\$a'); }
    else { expect(saved).toContain('"type":"heading"'); expect(saved).toContain('"type":"mathInline"'); }
    editor.commands.undo(); expect(editor.state.doc.textContent).toBe('target');
    editor.commands.redo(); expect(editor.getJSON()).toEqual(json);
  });
  it('recognizes a single inline formula inside a Chinese prose sentence on ordinary paste', () => {
    const editor = create(format);
    paste(editor, { 'text/plain': '你用缩写看位置变化的思路很有用。例如 $a$ ：' });
    expect(editor.getJSON().content?.[0].content?.map(node => node.type)).toEqual(['text', 'mathInline', 'text']);
    const formula = editor.getJSON().content?.[0].content?.[1];
    expect(formula && 'attrs' in formula && formula.attrs?.latex).toBe('a');
  });
  it('recognizes source-editor HTML wrappers without discarding semantic HTML', () => {
    const editor = create(format);
    paste(editor, { 'text/html': '<div style="font-family:monospace;white-space:pre"><div><span style="color:#f00"># 222</span></div><div><span>$a$ is \\(b\\)</span></div></div>', 'text/plain': '# 222\n$a$ is \\(b\\)' });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.getJSON().content?.[1].content?.filter(node => node.type === 'mathInline')).toHaveLength(2);
    editor.commands.selectAll(); paste(editor, { 'text/html': '<section><h2>HTML heading</h2><ul><li><b>Item</b></li></ul></section>', 'text/plain': '# deliberately different' });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading'); expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.state.doc.child(1).type.name).toBe('bulletList'); expect(editor.state.doc.child(1).firstChild?.firstChild?.firstChild?.marks[0].type.name).toBe('bold');
  });
  it('keeps prose, explicit plain paste, escaped syntax and code destinations literal', () => {
    const prose = '普通段落\n第二行 costs $100 and $200\nC:\\notes\\file.md';
    const editor = create(format); paste(editor, { 'text/plain': prose });
    expect(editor.state.doc.childCount).toBe(3); expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')).toBe(prose);
    editor.commands.selectAll(); paste(editor, { 'text/plain': '\\# literal \\$a\\$' });
    expect(editor.state.doc.textContent).toBe('\\# literal \\$a\\$');
    editor.commands.selectAll(); paste(editor, { 'text/plain': '# heading\n$a$', 'text/html': '<h1>heading</h1>', 'text/markdown': '# heading\n$a$' }, true);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); expect(editor.state.doc.textContent).toBe('# heading$a$');
    editor.commands.setContent('<pre><code>before</code></pre>'); editor.commands.setTextSelection({ from: 1, to: 7 });
    paste(editor, { 'text/plain': '# heading\n$a$\nA\tB\nC\tD', 'text/html': '<h1>heading</h1>' });
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock'); expect(editor.state.doc.textContent).toBe('# heading\n$a$\nA\tB\nC\tD');
  });
  it('gives internal structured data precedence over raw Markdown alternatives', () => {
    const editor = create(format);
    paste(editor, { [DOCUMENT_SLICE_MIME]: JSON.stringify({ version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '# literal' }] }], openStart: 0, openEnd: 0 }), 'text/markdown': '# heading', 'text/plain': '# heading' });
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); expect(editor.state.doc.textContent).toBe('# literal');
    editor.commands.selectAll(); paste(editor, { 'text/markdown': '# explicit', 'text/html': '<p>other</p>' });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading'); expect(editor.state.doc.textContent).toBe('explicit');
  });
  it('imports Word nested mixed lists and CF_HTML class styles without transport metadata', () => {
    const editor = create(format);
    const html = 'Version:1.0\r\nStartHTML:0000000100\r\nEndHTML:0000009999\r\nStartFragment:0000000120\r\nEndFragment:0000009900\r\n<html><head><style>.word{color:#c00;font-weight:bold}p.list{mso-list:l0 level1 lfo1}</style></head><body><!--StartFragment--><h2>Word标题</h2><p class="list"><!--[if !supportLists]><span style="mso-list:Ignore">3. </span><![endif]--><span class="word">第三项</span></p><p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">• </span>Nested</p><p class="list"><span style="mso-list:Ignore">4. </span>Fourth</p><!--EndFragment--></body></html>';
    paste(editor, { 'text/html': html, 'text/plain': 'Word标题\n3. 第三项\n• Nested\n4. Fourth' });
    expect(editor.state.doc.textContent).toBe('Word标题第三项NestedFourth');
    const list = editor.state.doc.child(1); expect(list.type.name).toBe('orderedList'); expect(list.attrs.start).toBe(3);
    expect(list.firstChild?.child(1).type.name).toBe('bulletList');
    expect(list.firstChild?.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'textColor']));
  });
  it('imports Excel displayed dates, zeros, merged cells and styled text into existing table cells', () => {
    const editor = create(format);
    paste(editor, { 'text/html': '<html><head><style>.xl1{background:#ff0;text-align:right}</style></head><body><table><tr><td rowspan="2" class="xl1">00123</td><td>2026/09/26</td><td></td></tr><tr><td>3.00</td><td><span style="mso-spacerun:yes">  spaced  </span><br>line</td></tr></table></body></html>', 'text/plain': '00123\t2026/09/26\t\n\t3.00\t  spaced  \nline' });
    const table = editor.state.doc.firstChild!; expect(table.type.name).toBe('table');
    expect(table.firstChild?.firstChild?.attrs).toMatchObject({ rowspan: 2, background: '#ffff00' });
    expect(table.textContent).toContain('001232026/09/263.00  spaced  line');
    editor.commands.setTextSelection(4); paste(editor, { 'text/html': '<p><b>rich</b></p>', 'text/plain': 'rich' });
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold');
  });
});

describe('external normalization boundaries', () => {
  it('has equivalent source-wrapper and Office results in the browser and Worker parser', () => {
    for (const html of ['<pre># heading\n\n$a$</pre>', '<p style="mso-list:l0 level1 lfo1"><!--[if !supportLists]><span style="mso-list:Ignore">1. </span><![endif]-->Item</p>', '<p><!--[if gte vml 1]><v:shape><v:imagedata src="file:///C:/word.png" o:title="chart"/></v:shape><![endif]--></p>']) {
      const worker = new WorkerDOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document;
      expect(normalizeExternalHtml(worker, html.length, undefined, { inferMarkdown: true })).toEqual(normalizedHtml(html));
    }
  });
  it('imports only a native CF_HTML fragment while retaining ancestor cells and head styles', () => {
    const html = 'Version:1.0\r\nStartHTML:0000000100\r\nStartFragment:0000000200\r\n<html><head><style>.cell{color:#c00}</style></head><body><p>outside before</p><table><tr><td class="cell"><!--StartFragment--><b>selected</b><!--EndFragment--></td><td>outside cell</td></tr></table><p>outside after</p></body></html>';
    const result = normalizedHtml(html); expect(result.content[0].type).toBe('table');
    expect(JSON.stringify(result.content)).toContain('selected'); expect(JSON.stringify(result.content)).toContain('#cc0000'); expect(JSON.stringify(result.content)).not.toContain('outside');
    const worker = new WorkerDOMParser().parseFromString(clipboardHtmlSource(html), 'text/html') as unknown as Document;
    expect(normalizeExternalHtml(worker, html, undefined, { inferMarkdown: true })).toEqual(result);
    expect(normalizedHtml('<p>before</p><!--StartFragment--><p>selected</p><!--EndFragment--><p>after</p>').content).toHaveLength(3);
  });
  it('preserves single-row/single-column text outside tables and infers them within cells including trailing blanks', () => {
    for (const raw of ['A\tB\t', 'A\nB\n']) {
      expect(normalizeExternalText(raw, { inferTable: true, inferMarkdown: true }).content[0].type).toBe('paragraph');
      expect(normalizeExternalText(raw, { inferTable: true, tableContext: true, inferMarkdown: true }).content[0].type).toBe('table');
    }
    const result = normalizeExternalText('A\tB\t\nC\tD\t', { inferTable: true, inferMarkdown: true });
    expect(result.content[0].content?.map(row => row.content?.length)).toEqual([3, 3]);
  });
  it('retains VML image meaning and uses a bitmap alternative only for an unreadable image by itself', () => {
    const html = '<p><!--[if gte vml 1]><v:shape><v:imagedata src="file:///C:/word.png" o:title="chart"/></v:shape><![endif]--></p>';
    const result = normalizedHtml(html); expect(JSON.stringify(result.content)).toContain('chart'); expect(result.diagnostics).toHaveLength(1);
    expect(needsClipboardImageFallback(html)).toBe(true); expect(needsClipboardImageFallback('<p>caption</p>' + html)).toBe(false);
    const editor = create(), file = new File(['png'], 'clipboard.png', { type: 'image/png' });
    paste(editor, { 'text/html': html, 'text/plain': '' }, false, [file]);
    expect(handlePastedImageFiles).toHaveBeenCalledWith(editor, [file], 'test.markdown', undefined);
    vi.clearAllMocks(); paste(editor, { 'text/html': '<p>caption</p>' + html, 'text/plain': 'caption' }, false, [file]);
    expect(handlePastedImageFiles).not.toHaveBeenCalled(); expect(editor.state.doc.textContent).toContain('caption'); expect(editor.state.doc.textContent).toContain('word.png');
  });
  it('falls back to readable text for empty HTML and filters Markdown URLs', () => {
    expect(normalizedHtml('<meta charset="utf-8">', '# fallback').content[0].type).toBe('heading');
    const result = normalizeExternalText('[label](javascript:alert)\n\n![chart](file:///C:/chart.png)', { inferMarkdown: true });
    expect(JSON.stringify(result.content)).not.toContain('"href":"javascript:'); expect(result.diagnostics).toHaveLength(1); expect(JSON.stringify(result.content)).toContain('chart.png');
  });
  it('preserves actual non-Markdown language code HTML and unknown wrappers containing semantic blocks', () => {
    expect(normalizedHtml('<pre><code class="language-python"># comment</code></pre>', '# comment').content[0].type).toBe('codeBlock');
    expect(normalizedHtml('<custom-wrapper><h2>Heading</h2><p>Paragraph</p></custom-wrapper>').content.map(node => node.type)).toEqual(['heading', 'paragraph']);
  });
});
