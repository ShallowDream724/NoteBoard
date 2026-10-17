import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { DOMParser as WorkerDOMParser } from 'linkedom';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { clipboardHtmlSource, normalizeExternalHtml, normalizeExternalText } from '../../src/features/editor-md/clipboard/external';
import { CLIPBOARD_LIMITS } from '../../src/features/editor-md/clipboard/normalize';

const wrap = (body: string, tag: string, depth: number) => `<${tag}>`.repeat(depth) + body + `</${tag}>`.repeat(depth);
const envelope = (body: string) => `Version:0.9\r\nStartHTML:0000000100\r\nStartFragment:0000000200\r\n<html><body>${wrap(`<p>outside</p><!--StartFragment-->${body}<!--EndFragment--><p>outside</p>`, 'div', 80)}</body></html>`;
function normalize(raw: string, worker: boolean, rich = false, plain?: string) {
  const source = clipboardHtmlSource(raw);
  const parser = worker ? new WorkerDOMParser() : new DOMParser();
  const document = parser.parseFromString(/<html[\s>]/i.test(source) ? source : `<html><body>${source}</body></html>`, 'text/html') as unknown as Document;
  return normalizeExternalHtml(document, raw, plain, { inferMarkdown: true, preservePresentation: rich });
}

describe.each([false, true])('web page clipboard (worker=%s)', worker => {
  it('preserves semantic structure through deep page layout and inline wrappers', () => {
    const body = '<h2>研究结果</h2><p>引言 ' + wrap('<strong>重点</strong>', 'span', 100) + ' 结尾</p><ul><li>结论</li></ul><table><tr><th>条件</th><th>结果</th></tr><tr><td>A</td><td>0.0368</td></tr></table><p>公式 \\(G\\)</p><div>\\[x=y\\]</div><blockquote><p>边界</p></blockquote><p>结束</p>';
    const result = normalize(envelope(body), worker);
    expect(result.content.map(node => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'table', 'paragraph', 'mathBlock', 'blockquote', 'paragraph']);
    expect(result.content[1].content?.find(node => node.text === '重点')?.marks).toEqual([{ type: 'bold' }]);
    const doc = getSchema(buildDocumentExtensions()).nodeFromJSON({ type: 'doc', content: result.content });
    doc.check(); expect(doc.textContent).not.toContain('outside'); expect(doc.textContent).toContain('研究结果引言 重点 结尾结论条件结果A0.0368');
  });

  it('imports a 3000-line conversation from a page shell without dropping the tail', () => {
    const source = Array.from({ length: 300 }, (_, index) => [
      `<article><h2>回合 ${index}</h2>`, '<p><b>研究摘要</b>与约束条件</p>',
      '<ul><li>第一项</li><li>第二项</li></ul>', '<table>', '<tr><th>条件</th><th>结果</th></tr>',
      '<tr><td>A</td><td>0.0857</td></tr>', '</table>', '<pre><code>sample = 1\nprint(sample)</code></pre>',
      '<p>行内公式 \\(r^4\\)</p>', `<p>回合末尾 ${index}</p></article>`,
    ].join('\n')).join('\n');
    // The newline inside the code example is additional content, not a line limit workaround.
    expect(source.split('\n').length).toBeGreaterThanOrEqual(3000);
    const raw = envelope(source), result = normalize(raw, worker);
    expect(result.content.filter(node => node.type === 'heading')).toHaveLength(300);
    expect(result.content.filter(node => node.type === 'table')).toHaveLength(300);
    expect(result.content.filter(node => node.type === 'bulletList')).toHaveLength(300);
    expect(result.content.filter(node => node.type === 'codeBlock')).toHaveLength(300);
    const doc = getSchema(buildDocumentExtensions()).nodeFromJSON({ type: 'doc', content: result.content });
    doc.check(); expect(doc.textContent).toContain('回合末尾 299');
  });

  it('supports deeply wrapped Markdown source without interpreting ordinary escaped prose', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `## 回合 ${index}\n\n内容 **${index}**`).join('\n');
    const result = normalize(wrap(`<pre>${source}</pre>`, 'div', 80), worker, false, source);
    expect(result.content.filter(node => node.type === 'heading')).toHaveLength(1000);
    expect(result.content.at(-1)?.content?.at(-1)?.text).toBe('999');
    expect(normalizeExternalText('\\# literal \\$a\\$', { inferMarkdown: true }).content[0].content?.[0].text).toBe('\\# literal \\$a\\$');
  });

  it('filters explicitly hidden page subtrees without dropping accessible rendered formulas', () => {
    const raw = '<p>visible</p><div hidden>' + wrap('<p>hidden attribute</p>', 'div', 100) + '</div><div style="display:none">hidden style</div><div style="content-visibility:hidden">hidden content</div><div inert><p>visible inert text</p></div><p aria-hidden="true">visible duplicate with no rendering proof</p><span class="katex"><span aria-hidden="true">glyphs</span><math><annotation encoding="application/x-tex">a+b</annotation></math></span>';
    const result = normalize(raw, worker), text = JSON.stringify(result.content);
    expect(text).not.toContain('hidden attribute'); expect(text).not.toContain('hidden style'); expect(text).not.toContain('hidden content');
    expect(text).toContain('visible inert text'); expect(text).toContain('visible duplicate'); expect(text).not.toContain('glyphs');
    expect(result.content.at(-1)?.content?.at(-1)?.attrs?.latex).toBe('a+b');
  });

  it('still rejects real excessive document nesting with a specific error', () => {
    expect(() => normalize(wrap('<p>deep</p>', 'blockquote', CLIPBOARD_LIMITS.depth + 2), worker)).toThrow(/正文嵌套/);
  });
  it('respects inherited visibility while retaining descendants that restore it', () => {
    const raw = '<div style="visibility:hidden"># secret <span style="visibility:visible">shown</span></div><p style="visibility:hidden">secret <b style="visibility:visible">bold</b> secret</p><pre style="visibility:hidden">secret <code style="visibility:visible">a = 1</code></pre><p>tail</p>';
    const result = normalize(raw, worker), doc = getSchema(buildDocumentExtensions()).nodeFromJSON({ type: 'doc', content: result.content });
    doc.check(); expect(doc.textContent).toBe('shownbolda = 1tail');
    expect(result.content.map(node => node.type)).toEqual(['paragraph', 'paragraph', 'codeBlock', 'paragraph']);
    expect(normalize('<div style="visibility:hidden"># secret</div><div>shown</div>', worker).content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'shown' }] }]);
  });
});
