import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { DOMParser as WorkerDOMParser } from 'linkedom';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { initializeEditorDocument, serializeEditorDocument, type RichDocumentFormat } from '../../src/features/editor-md/editorDocumentCodec';
import { NATIVE_DOCUMENT_HEADER } from '../../src/core/nativeDocument';
import { ClipboardImport, DOCUMENT_SLICE_MIME, importClipboardSnapshot } from '../../src/features/editor-md/clipboard/clipboardImport';
import { clipboardHtmlSource, needsClipboardImageFallback, normalizeExternalHtml, normalizeExternalText } from '../../src/features/editor-md/clipboard/external';
import { handlePastedImageFiles } from '../../src/features/editor-md/imagePaste';
import { DocumentCapabilityGuard } from '../../src/features/document-format/capabilityGuard';

vi.mock('../../src/features/editor-md/imagePaste', () => ({ handlePastedImageFiles: vi.fn() }));
const conversion = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/features/document-format/NativeConversionDialog', () => ({ requestNativeConversion: conversion.confirm }));
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.clearAllMocks(); });
function create(format: RichDocumentFormat = 'markdown', content = '<p>target</p>') {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), ClipboardImport.configure({ docKey: `test.${format}` }), DocumentCapabilityGuard], content });
  initializeEditorDocument(editor, format === 'noteboard' ? `${NATIVE_DOCUMENT_HEADER}\n` : '', format, '', `test.${format}`);
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
  it('keeps Markdown image-labeled links as links and explicit image syntax as pictures', () => {
    const editor = create(format), url = 'https://p.kagi.com/proxy/favicons?c=source';
    paste(editor, { 'text/markdown': `([image](${url}))` });
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.content.content.some(node => node.marks.some(mark => mark.type.name === 'link' && mark.attrs.href === url))).toBe(true);
    editor.commands.selectAll(); paste(editor, { 'text/markdown': `![illustration](${url})` });
    expect(editor.state.doc.firstChild?.type.name).toBe('image');
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
    expect(list.firstChild?.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(format === 'noteboard' ? ['bold', 'textColor'] : ['bold']));
    if (format === 'markdown') expect(list.firstChild?.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'textColor')).toBe(false);
  });
  it('imports Excel displayed dates, zeros, merged cells and styled text into existing table cells', () => {
    const editor = create(format);
    paste(editor, { 'text/html': '<html><head><style>.xl1{background:#ff0;text-align:right}</style></head><body><table><tr><td rowspan="2" class="xl1">00123</td><td>2026/09/26</td><td></td></tr><tr><td>3.00</td><td><span style="mso-spacerun:yes">  spaced  </span><br>line</td></tr></table></body></html>', 'text/plain': '00123\t2026/09/26\t\n\t3.00\t  spaced  \nline' });
    const table = editor.state.doc.firstChild!; expect(table.type.name).toBe('table');
    expect(table.firstChild?.firstChild?.attrs).toMatchObject(format === 'noteboard' ? { rowspan: 2, background: '#ffff00' } : { rowspan: 1, background: null });
    expect(table.textContent).toContain('001232026/09/263.00  spaced  line');
    editor.commands.setTextSelection(4); paste(editor, { 'text/html': '<p><b>rich</b></p>', 'text/plain': 'rich' });
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold');
  });
  it('keeps translated web text, links and emphasis without promoting MD for page appearance', async () => {
    const editor = create(format);
    const html = '<p style="text-align:center;color:#444"><span style="color:rgb(180, 30, 20);background:#ff0">中文译文 <a href="https://arxiv.org/html/2410.05160#bib.bib1">[1]</a> <strong>重点</strong> <em>术语</em></span></p>';
    paste(editor, { 'text/html': html, 'text/plain': '中文译文 [1] 重点 术语' });
    expect(editor.state.doc.textContent).toBe('中文译文 [1] 重点 术语');
    const marks = editor.getJSON().content?.[0].content?.flatMap(node => node.marks ?? []) ?? [];
    expect(marks).toEqual(expect.arrayContaining([{ type: 'link', attrs: expect.objectContaining({ href: 'https://arxiv.org/html/2410.05160#bib.bib1' }) }, { type: 'bold' }, { type: 'italic' }]));
    expect(marks.some(mark => mark.type === 'textColor')).toBe(format === 'noteboard');
    await Promise.resolve(); expect(conversion.confirm).not.toHaveBeenCalled();
  });
  it('Ctrl+Shift+V skips rich HTML and conversion while inserting only plain text', async () => {
    const editor = create(format);
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true })));
    paste(editor, { 'text/html': '<p style="color:#f00;text-align:center"><a href="https://example.com">label</a></p>', 'text/plain': 'label' });
    expect(editor.state.doc.textContent).toBe('label'); expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    await Promise.resolve(); expect(conversion.confirm).not.toHaveBeenCalled();
  });
});

describe('external normalization boundaries', () => {
  it('omits decorative favicons in copied web text without dropping links or authored pictures', () => {
    const icon = 'https://p.kagi.com/proxy/favicons?c=source';
    const html = `<h3><a href="https://www.whatsapp.com/download">Download WhatsApp</a></h3><a href="https://www.whatsapp.com/download"><img src="${icon}" alt="网站图标"></a><p>description <img src="https://example.com/icon.png" width="16" height="16" alt=""> text</p><img src="https://example.com/chart.png" width="600" height="400" alt="chart"><figure><img src="${icon}" width="16" height="16" alt="favicon design"><figcaption>Authored illustration</figcaption></figure>`;
    const result = normalizedHtml(html);
    const worker = new WorkerDOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document;
    expect(normalizeExternalHtml(worker, html, undefined)).toEqual(result);
    expect(result.content.filter(node => node.type === 'image').map(node => node.attrs?.src)).toEqual(['https://example.com/chart.png', icon]);
    expect(result.content[0].content?.[0].marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://www.whatsapp.com/download' } });
    expect(result.content.flatMap(node => node.content?.map(child => child.text ?? '') ?? []).join('')).toContain('description  text');
    expect(normalizedHtml(`<img src="${icon}" width="16" height="16" alt="">`).content[0].type).toBe('image');
    expect(normalizedHtml('<p>label<img src="https://example.com/icon.png" width="16" height="16" alt="important symbol"></p>').content.some(node => node.type === 'image')).toBe(true);
  });
  it('resolves relative web links and images from CF_HTML SourceURL identically in the UI and Worker', () => {
    const html = 'Version:1.0\r\nStartHTML:0000000100\r\nStartFragment:0000000200\r\nSourceURL:https://arxiv.org/html/2410.05160\r\n<html><body><!--StartFragment--><p><a href="#bib.bib1">citation</a> <a href="/abs/2410.05160">paper</a> <a href="related">related</a></p><img src="images/figure.png"><!--EndFragment--></body></html>';
    const options = { preservePresentation: false };
    const result = normalizeExternalHtml(new DOMParser().parseFromString(clipboardHtmlSource(html), 'text/html'), html, undefined, options);
    const worker = new WorkerDOMParser().parseFromString(clipboardHtmlSource(html), 'text/html') as unknown as Document;
    expect(normalizeExternalHtml(worker, html, undefined, options)).toEqual(result);
    const links = result.content[0].content?.flatMap(node => node.marks?.filter(mark => mark.type === 'link').map(mark => mark.attrs?.href) ?? []);
    expect(links).toEqual(['https://arxiv.org/html/2410.05160#bib.bib1', 'https://arxiv.org/abs/2410.05160', 'https://arxiv.org/html/related']);
    expect(result.content[1].attrs?.src).toBe('https://arxiv.org/html/images/figure.png');
  });
  it('uses an explicit web base without using the local parser URL or importing unsafe schemes', () => {
    const html = '<html><head><base href="../assets/"></head><body><p><a href="guide.html#one">guide</a><a href="javascript:alert(1)">unsafe</a><a href="mailto:person@example.com">mail</a></p><img src="//cdn.example.com/a.png"></body></html>';
    const result = normalizeExternalHtml(new DOMParser().parseFromString(html, 'text/html'), html, undefined, { sourceUrl: 'https://example.com/docs/page.html' });
    expect(result.content[0].content?.[0].marks?.[0].attrs?.href).toBe('https://example.com/assets/guide.html#one');
    expect(result.content[0].content?.[1].marks).toBeUndefined(); expect(result.content[0].content?.[2].marks?.[0].attrs?.href).toBe('mailto:person@example.com');
    expect(result.content[1].attrs?.src).toBe('https://cdn.example.com/a.png');
    expect(normalizedHtml('<p><a href="relative.md">local</a></p>').content[0].content?.[0].marks?.[0].attrs?.href).toBe('relative.md');
    const unsafe = '<html><head><base href="javascript:alert(1)"></head><body><p><a href="#one">safe</a></p></body></html>';
    expect(normalizeExternalHtml(new DOMParser().parseFromString(unsafe, 'text/html'), unsafe, undefined, { sourceUrl: 'https://example.com/page' }).content[0].content?.[0].marks?.[0].attrs?.href).toBe('https://example.com/page#one');
  });
  it('shares portable appearance policy with the Worker DOM and retains figure caption text', () => {
    const html = '<p style="color:#f00;text-align:center"><a href="https://example.com" style="background:#ff0">link</a></p><figure><img src="https://example.com/a.png"><figcaption><b>caption</b></figcaption></figure><table><tr><td rowspan="2" style="background:#ff0;vertical-align:bottom">merged</td><td>A</td></tr><tr><td>B</td></tr></table>';
    const options = { inferMarkdown: true, preservePresentation: false };
    const result = normalizeExternalHtml(new DOMParser().parseFromString(html, 'text/html'), html, undefined, options);
    const worker = new WorkerDOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document;
    expect(normalizeExternalHtml(worker, html, undefined, options)).toEqual(result);
    expect(result.content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph', 'table']);
    expect(result.content[2].content?.[0]).toMatchObject({ text: 'caption', marks: [{ type: 'bold' }] });
    const json = JSON.stringify(result); expect(json).not.toContain('textColor'); expect(json).not.toContain('highlight'); expect(json).not.toContain('textAlign'); expect(json).not.toContain('captionContent');
    expect(result.content[3].content?.map(row => row.content?.length)).toEqual([2, 2]);
    expect(json.match(/merged/g)).toHaveLength(1);
  });
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
