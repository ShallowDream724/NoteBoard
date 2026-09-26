import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { DOMParser as WorkerDOMParser } from 'linkedom';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { initializeEditorDocument, serializeEditorDocument, type RichDocumentFormat } from '../../src/features/editor-md/editorDocumentCodec';
import { ClipboardImport, importClipboardSnapshot } from '../../src/features/editor-md/clipboard/clipboardImport';
import { normalizeExternalHtml } from '../../src/features/editor-md/clipboard/external';
import { clipboardTextMath } from '../../src/features/editor-md/clipboard/htmlMath';
import { readMath } from '../../src/features/editor-md/mathSyntax';

const html = String.raw`<p><strong>\(C1'\) 就是“核糖的第 1 号碳原子”，读作“碳一撇”。</strong></p>
<ul><li><strong>C</strong>：表示碳原子。</li><li>核糖的五个碳：\(C1',C2',C3',C4',C5'\)。</li><li>例如 \(N9\)。</li></ul>
<p>因此：</p><p>\[ \boxed{N9-C1' =\text{腺嘌呤的第9号氮，与核糖的第1号碳相连}} \]</p>
<p><strong>这里的撇号只用于编号，与 \(\Delta G^{\prime\circ}\) 的含义不同。</strong></p>`;
function mathNodes(nodes: JSONContent[]): JSONContent[] { return nodes.flatMap(node => node.type?.startsWith('math') ? [node] : mathNodes(node.content ?? [])); }
function normalize(source: string, worker = false) {
  const document = worker ? new WorkerDOMParser().parseFromString(`<html><body>${source}</body></html>`, 'text/html') as unknown as Document : new DOMParser().parseFromString(source, 'text/html');
  return normalizeExternalHtml(document, source, undefined, { inferMarkdown: true });
}
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

describe.each<RichDocumentFormat>(['noteboard', 'markdown'])('%s AI rich math paste', format => {
  it('pastes the reported rich HTML, keeps prose/list marks, saves and reopens actual math nodes', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), ClipboardImport.configure({ docKey: 'math-paste' })], content: '<p>target</p>' }); editors.push(editor);
    initializeEditorDocument(editor, format === 'noteboard' ? '#!noteboard 1\n' : '', format);
    editor.commands.selectAll();
    expect(importClipboardSnapshot(editor.view, { formats: { 'text/html': html, 'text/plain': 'HTML must retain ownership' } })).toBe(true);
    editor.state.doc.check();
    const nodes = editor.getJSON().content!;
    expect(nodes.map(node => node.type)).toEqual(['paragraph', 'bulletList', 'paragraph', 'mathBlock', 'paragraph']);
    expect(mathNodes(nodes).map(node => node.attrs?.latex)).toEqual(["C1'", "C1',C2',C3',C4',C5'", 'N9', String.raw`\boxed{N9-C1' =\text{腺嘌呤的第9号氮，与核糖的第1号碳相连}}`, String.raw`\Delta G^{\prime\circ}`]);
    expect(nodes[0].content?.[1].marks).toContainEqual({ type: 'bold' });
    const saved = serializeEditorDocument(editor);
    editor.commands.undo(); expect(editor.state.doc.textContent).toBe('target');
    editor.commands.redo(); expect(editor.getJSON().content).toEqual(nodes);
    initializeEditorDocument(editor, saved, format); editor.state.doc.check();
    expect(mathNodes(editor.getJSON().content!).map(node => node.attrs?.latex)).toEqual(mathNodes(nodes).map(node => node.attrs?.latex));
  });
});

describe('HTML formula boundaries', () => {
  it('joins styled spans within formulas and retains surrounding colors and explicit breaks', () => {
    const result = normalize(String.raw`<h2><span style="color:#ff0000">前 \</span><b>(x</b><i>^2\)</i> 后</h2><p>\[\begin{aligned}a&amp;=b\\<br>c&amp;=d\end{aligned}\]</p>`);
    expect(mathNodes(result.content).map(node => node.attrs?.latex)).toEqual(['x^2', '\\begin{aligned}a&=b\\\\\nc&=d\\end{aligned}']);
    expect(result.content[0].content?.[0]).toMatchObject({ text: '前 ', marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }] });
    expect(result.content[0].content?.at(-1)?.text).toBe(' 后');
  });
  it('does not infer math in code/links, escaped delimiters, currency or unmatched expressions', () => {
    const source = String.raw`<p><code>\(code\) $x$</code><a href="https://example.com/">\(link\)</a> \\(escaped\\) costs $100 and $200; \(unclosed</p><pre><code class="language-python">\[literal\]</code></pre>`;
    const result = normalize(source);
    expect(mathNodes(result.content)).toHaveLength(0);
    expect(result.content.at(-1)).toMatchObject({ type: 'codeBlock', content: [{ type: 'text', text: String.raw`\[literal\]` }] });
    expect(JSON.stringify(result.content)).toContain('unclosed');
  });
  it('imports a single formula from KaTeX/MathML and MathJax TeX scripts without visual duplicates', () => {
    const katex = '<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/X-TEX">x^2</annotation></semantics></math></span><span class="katex-html">DUPLICATE</span></span>';
    const source = `<p>before ${katex} after</p><div class="katex-display">${katex}</div><div><script type="math/tex; mode=display">y=2</script></div><p><span data-math-inline latex="z" delimiter="$"></span></p><script>bad()</script>`;
    const result = normalize(source);
    expect(mathNodes(result.content).map(node => [node.type, node.attrs?.latex])).toEqual([['mathInline', 'x^2'], ['mathBlock', 'x^2'], ['mathBlock', 'y=2'], ['mathInline', 'z']]);
    expect(JSON.stringify(result.content)).not.toContain('DUPLICATE'); expect(JSON.stringify(result.content)).not.toContain('bad()');
    expect(normalize(source, true)).toEqual(result);
  });
  it('keeps table and Word-list structure while splitting standalone display formulas', () => {
    const source = String.raw`<table><tr><td rowspan="2" style="background:#ff0;text-align:right"><b>\(x\)</b></td><td>00123</td></tr><tr><td>\[y=2\]</td></tr></table><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.</span>\[z\]</p>`;
    const result = normalize(source);
    expect(result.content[0].content?.[0].content?.[0]).toMatchObject({ attrs: { rowspan: 2, background: '#ffff00' }, content: [{ attrs: { textAlign: 'right' } }] });
    expect(result.content[1].content?.[0].content?.map(node => node.type)).toEqual(['paragraph', 'mathBlock']);
    expect(normalize(source, true)).toEqual(result);
  });
  it('uses a bounded scan for adversarial malformed delimiters and leaves their text intact', () => {
    const source = String.raw`\(` + '{'.repeat(10000) + String.raw`\(`.repeat(10000);
    const budget = { remaining: 64 }; expect(readMath(source, 0, false, budget)).toBeNull(); expect(budget.remaining).toBe(-1);
    expect(clipboardTextMath([{ type: 'text', text: source }])).toEqual([{ type: 'text', text: source }]);
  });
  it('does not create blank paragraphs around standalone display math', () => {
    expect(normalize(String.raw`<p>  \[x\]  </p>`).content.map(node => node.type)).toEqual(['mathBlock']);
  });
  it('handles 10000 HTML formula paragraphs with the same browser and Worker policy', () => {
    const source = String.raw`<p><b>编号</b> \(C1'\)</p>`.repeat(10000);
    const result = normalize(source, true);
    expect(result.content).toHaveLength(10000); expect(mathNodes(result.content)).toHaveLength(10000);
    expect(normalize(html, true)).toEqual(normalize(html));
  });
});
