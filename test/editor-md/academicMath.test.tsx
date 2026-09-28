import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import cases from '../fixtures/math/academic-math.json';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';
import { mathClosingDelimiter, readMath, writeMath, type MathDelimiter } from '../../src/features/editor-md/mathSyntax';
import { renderMath } from '../../src/features/editor-md/mathRendering';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';

const editors: Editor[] = [];
function editor() {
  const value = new Editor({ extensions: [StarterKit, MathInline, MathBlock, Markdown], content: '' });
  editors.push(value);
  return value;
}
afterEach(() => { editors.splice(0).forEach((value) => value.destroy()); });
function formulas(value: Editor) {
  const found: { latex: string; delimiter: MathDelimiter; type: string }[] = [];
  value.state.doc.descendants((node) => {
    if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') {
      found.push({ latex: node.attrs.latex, delimiter: node.attrs.delimiter, type: node.type.name });
    }
  });
  return found;
}
function type(value: Editor, text: string) {
  for (const char of text) {
    const { from, to } = value.state.selection;
    const handled = value.view.someProp('handleTextInput', (handler) => handler(value.view, from, to, char, () => value.state.tr.insertText(char)));
    if (!handled) value.view.dispatch(value.state.tr.insertText(char));
  }
}
function enter(value: Editor) {
  return value.view.someProp('handleKeyDown', (handler) => handler(value.view, new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })));
}
async function compose(value: Editor, text: string) {
  value.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  value.view.dispatch(value.state.tr.insertText(text));
  value.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
}

describe('学术公式语料与源码往返', () => {
  for (const sample of cases) {
    it(sample.id + ' ' + sample.title, async () => {
      const result = await renderMath(sample.latex, true);
      expect(!result.error, result.error).toBe(sample.supported);
      if (!sample.supported) return;
      const value = editor();
      const delimiters: MathDelimiter[] = sample.displayOnly ? ['$$', '\\['] : ['$', '\\(', '$$', '\\['];
      for (const delimiter of delimiters) {
        const source = writeMath({ latex: sample.latex, delimiter }, delimiter === '$$' || delimiter === '\\[');
        parseMarkdown(value, source);
        expect(formulas(value), delimiter).toMatchObject([{ latex: sample.latex, delimiter }]);
        const output = serializeMarkdown(value);
        expect(output, delimiter).toContain(sample.latex);
        expect(output, delimiter).toContain(delimiter);
        parseMarkdown(value, output);
        expect(formulas(value), delimiter).toMatchObject([{ latex: sample.latex, delimiter }]);
      }
    });
  }
});

describe('定界符空白、上下文与真实输入', () => {
  it('中文段落手动输入 $a$ 并继续中文标点时建立行内节点', () => {
    const value = editor();
    type(value, '你用缩写看位置变化的思路很有用。例如 $a$ ：');
    expect(formulas(value)).toEqual([{ latex: 'a', delimiter: '$', type: 'mathInline' }]);
  });
  it('输入法一次提交闭合美元号与其后标点时仍识别公式', async () => {
    const value = editor();
    const source = '你用缩写看位置变化的思路很有用。例如 $a$ ：';
    await compose(value, source);
    expect(formulas(value)).toEqual([{ latex: 'a', delimiter: '$', type: 'mathInline' }]);
    expect(value.getText()).toBe(source);
    expect(value.commands.undoInputRule()).toBe(true);
    expect(formulas(value)).toHaveLength(0);
    expect(value.state.doc.textContent).toBe(source);
  });
  it('行首、行中和行尾的闭合符只替换光标前的公式，保留已有后文', () => {
    for (const [before, at, result] of [
      ['后文', 1, '$a$后文'],
      ['前文后文', 3, '前文$a$后文'],
      ['前文', 3, '前文$a$'],
    ] as const) {
      const value = editor();
      value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: before }] }] });
      value.commands.setTextSelection(at);
      type(value, '$a$');
      expect(formulas(value), before).toEqual([{ latex: 'a', delimiter: '$', type: 'mathInline' }]);
      expect(value.getText(), before).toBe(result);
    }
    const selected = editor();
    selected.commands.setContent('<p>前XY后</p>');
    selected.commands.setTextSelection({ from: 2, to: 4 });
    type(selected, '$a$');
    expect(formulas(selected).map(({ latex }) => latex)).toEqual(['a']);
    expect(selected.getText()).toBe('前$a$后');
  });
  it('输入法一次提交普通后文和连续公式，只处理本次输入并可撤销', async () => {
    const value = editor();
    await compose(value, '$a$和$b$ 是变量');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'b']);
    expect(value.getText()).toBe('$a$和$b$ 是变量');
    expect(value.commands.undoInputRule()).toBe(true);
    expect(formulas(value)).toHaveLength(0);
    expect(value.state.doc.textContent).toBe('$a$和$b$ 是变量');
    expect(value.commands.undo()).toBe(true);
    expect(value.state.doc.textContent).toBe('');
    expect(value.commands.redo()).toBe(true);
    expect(value.state.doc.textContent).toBe('$a$和$b$ 是变量');
  });
  it('非输入法的批量文字输入也按本次提交范围识别', () => {
    const value = editor();
    const { from, to } = value.state.selection;
    const input = '前文$a$ 是变量';
    const handled = value.view.someProp('handleTextInput', handler => handler(value.view, from, to, input, () => value.state.tr.insertText(input)));
    if (!handled) value.view.dispatch(value.state.tr.insertText(input));
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a']);
    expect(value.getText()).toBe(input);
  });
  it('长段落的行中与行尾跨样式输入窗口不越界，保留既有公式与后文', () => {
    const value = editor();
    const left = '前'.repeat(550), middle = '中'.repeat(30), right = '后'.repeat(550);
    value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: left },
      { type: 'text', text: middle, marks: [{ type: 'bold' }] },
      { type: 'mathInline', attrs: { latex: 'z' } },
      { type: 'text', text: right, marks: [{ type: 'italic' }] },
    ] }] });
    value.commands.setTextSelection(1 + left.length + 15);
    type(value, '$a$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'z']);
    const first = value.state.doc.firstChild?.child(2);
    expect(first?.marks.map(mark => mark.type.name)).toContain('bold');
    value.commands.setTextSelection(value.state.doc.firstChild!.nodeSize - 1);
    type(value, '$b$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'z', 'b']);
    expect(value.state.doc.firstChild?.lastChild?.type.name).toBe('mathInline');
    expect(value.state.doc.firstChild?.lastChild?.marks.map(mark => mark.type.name)).toContain('italic');
    let afterExisting = -1;
    value.state.doc.descendants((node, pos) => { if (node.type.name === 'mathInline' && node.attrs.latex === 'z') afterExisting = pos + node.nodeSize; });
    value.commands.setTextSelection(afterExisting);
    type(value, '$c$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'z', 'c', 'b']);
    expect(value.getText()).toBe(left + middle.slice(0, 15) + '$a$' + middle.slice(15) + '$z$$c$' + right + '$b$');
  });
  it('输入法补全已有未闭合开头，只转换跨越本次提交边界的公式', async () => {
    const value = editor();
    value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '说明 $a' }] }] });
    value.commands.setTextSelection(6);
    await compose(value, '$ 后文');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a']);
    expect(value.getText()).toBe('说明 $a$ 后文');
    expect(value.commands.undoInputRule()).toBe(true);
    expect(value.state.doc.textContent).toBe('说明 $a$ 后文');
  });
  it('紧邻的两个公式都保留为独立节点', async () => {
    const value = editor();
    await compose(value, '$a$$b$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'b']);
    expect(value.getText()).toBe('$a$$b$');
    parseMarkdown(value, '$a$$b$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'b']);
    expect(serializeMarkdown(value)).toContain('$a$$b$');
    value.commands.clearContent();
    type(value, '$a$$b$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a', 'b']);
  });
  it('输入法在已有后文前替换选区，保留后文和粗体样式', async () => {
    const value = editor();
    value.commands.setContent('<p><strong>前XY后</strong></p>');
    value.commands.setTextSelection({ from: 2, to: 4 });
    await compose(value, '$a$ 是变量');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['a']);
    expect(value.getText()).toBe('前$a$ 是变量后');
    const formula = value.state.doc.firstChild?.child(1);
    expect(formula?.marks.map(mark => mark.type.name)).toContain('bold');
    expect(value.state.doc.firstChild?.lastChild?.marks.map(mark => mark.type.name)).toContain('bold');
  });
  it('输入法提交代码、转义美元号和金额时不重解释旧文本', async () => {
    const value = editor();
    for (const text of ['`$a$`', String.raw`\$a\$`, 'costs $100 and $200', '$5，并且$2']) {
      value.commands.clearContent();
      await compose(value, text);
      expect(formulas(value), text).toHaveLength(0);
      expect(value.state.doc.textContent, text).toBe(text.startsWith('`') ? '$a$' : text);
    }
    value.commands.setContent('<p><code>before</code></p>');
    value.commands.setTextSelection(3);
    await compose(value, '$a$');
    expect(formulas(value)).toHaveLength(0);
    value.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '$old$' }] }] });
    value.commands.setTextSelection(6);
    await compose(value, ' 普通后文');
    expect(formulas(value)).toHaveLength(0);
    expect(value.state.doc.textContent).toBe('$old$ 普通后文');
    value.commands.clearContent();
    await compose(value, '价格 $100 and $200；公式 $x$');
    expect(formulas(value).map(({ latex }) => latex)).toEqual(['x']);
    expect(value.getText()).toContain('$100 and $200');
  });
  for (const delimiter of ['$', '\\(', '$$', '\\['] as MathDelimiter[]) {
    for (const padding of ['', ' ', '  ', '\t']) {
      it('空白 ' + JSON.stringify([delimiter, padding]), () => {
        const value = editor();
        const latex = padding + 'x + y' + padding;
        const source = '前文 ' + delimiter + latex + mathClosingDelimiter(delimiter) + ' 后文';
        parseMarkdown(value, source);
        expect(formulas(value)).toMatchObject([{ latex, delimiter }]);
        expect(serializeMarkdown(value)).toContain(delimiter + latex + mathClosingDelimiter(delimiter));
      });
    }
    it('现场输入 ' + delimiter, () => {
      const value = editor();
      type(value, '前文 ' + delimiter + 'x^2' + mathClosingDelimiter(delimiter));
      expect(formulas(value)).toMatchObject([{ latex: 'x^2', delimiter }]);
      expect(value.getText()).toContain('前文');
      expect(value.commands.undoInputRule()).toBe(true);
      expect(formulas(value)).toHaveLength(0);
    });
  }
  for (const delimiter of ['$$', '\\['] as MathDelimiter[]) {
    it(delimiter + ' Enter 进入空公式并可一步撤销', () => {
      const value = editor();
      type(value, delimiter);
      expect(enter(value)).toBe(true);
      expect(formulas(value)).toEqual([{ latex: '', delimiter, type: 'mathBlock' }]);
      expect(value.state.selection.$from.nodeAfter?.type.name).toBe('mathBlock');
      value.commands.undo();
      expect(formulas(value)).toHaveLength(0);
    });
  }
  it('公式后接数字与货币分别处理', () => {
    expect(readMath('$x$2')?.latex).toBe('x');
    const value = editor();
    parseMarkdown(value, '价格 $100 and $200；公式 $x$2');
    expect(formulas(value)).toMatchObject([{ latex: 'x', delimiter: '$' }]);
  });
  it('中文输入法的 ￥￥ Enter 建立标准 $$ 块，单个货币符号保持文本', () => {
    const value = editor();
    type(value, '￥￥');
    expect(enter(value)).toBe(true);
    expect(formulas(value)).toEqual([{ latex: '', delimiter: '$$', type: 'mathBlock' }]);
    expect(serializeMarkdown(value)).toContain('$$');
    expect(serializeMarkdown(value)).not.toContain('￥');
    parseMarkdown(value, '￥5，并且￥2；￥ x ￥');
    expect(formulas(value)).toHaveLength(0);
    parseMarkdown(value, '`￥￥`');
    value.commands.setTextSelection(3);
    enter(value);
    expect(formulas(value)).toHaveLength(0);
  });
  it('两个美元金额不能吞掉中间正文，也不能借用后续公式的定界符', () => {
    const value = editor();
    for (const text of ['$5，并且$2', '$5并且$2', '$5, and $2', '$ 5 and $ 2', '$.50 plus $.25']) {
      parseMarkdown(value, text);
      expect(formulas(value), text).toHaveLength(0);
      expect(value.state.doc.textContent).toBe(text);
      parseMarkdown(value, text + '；公式 $x+2$');
      expect(formulas(value), text).toMatchObject([{ latex: 'x+2', delimiter: '$' }]);
      expect(value.state.doc.textContent).toContain(text);
    }
  });
  it('带货币单位的金额不借后续公式的开头闭合，数学乘积仍可用', () => {
    const value = editor();
    for (const text of ['$100美元$ x $', '$5美元之后公式$x$', '$5USD$x$', '$10EUR$ x $', '$5USD then $x$']) {
      parseMarkdown(value, text);
      expect(formulas(value), text).toMatchObject([{ latex: expect.stringMatching(/^ *x *$/), delimiter: '$' }]);
      expect(value.state.doc.textContent).toMatch(/\$(100|5|10)/);
    }
    for (const latex of ['2 kg', '2 ab', '5', ' 5 ', '2 x', '5\\,\\mathrm{USD}', '2\\text{ and }3', '5\\text{美元}']) {
      expect(readMath('$' + latex + '$')?.latex, latex).toBe(latex);
    }
  });
  it('代码、转义、链接目标不提供定界符闭合', () => {
    const value = editor();
    for (const text of [
      '`\\(x\\)` 与 `$y$`', '```latex\n\\[x\\]\n```',
      String.raw`\\[2pt]`, String.raw`\$x\$`,
      String.raw`[\(x](https://example.test/\))`,
      String.raw`\(x ` + '`code \\)`' + ' tail',
    ]) {
      parseMarkdown(value, text);
      expect(formulas(value), text).toHaveLength(0);
    }
  });
  it('矩阵行距、注释和空行保持原文', () => {
    const value = editor();
    const latex = '\\begin{matrix}\n1&2\\\\[2pt]\n3&4\n\\end{matrix}\n% \\] 是注释\n\nx';
    parseMarkdown(value, '\\[\n' + latex + '\n\\]');
    expect(formulas(value)).toMatchObject([{ latex, delimiter: '\\[' }]);
    expect(serializeMarkdown(value)).toContain(latex);
  });
  it('独立公式围栏保留错误矩阵，不把内部行距拆成另一个公式', async () => {
    const value = editor();
    const latex = String.raw`\begin{pmatrix}
1 & 2 \\\[2pt\]
3 & 4
\end{pmatrix}`;
    const source = '\\[\n' + latex + '\n\\]';
    parseMarkdown(value, source);
    expect(formulas(value)).toEqual([{ latex, delimiter: '\\[', type: 'mathBlock' }]);
    expect((await renderMath(latex, true)).error).toBeTruthy();
    const saved = serializeMarkdown(value);
    expect(saved).toContain(source);
    parseMarkdown(value, saved);
    expect(formulas(value)).toEqual([{ latex, delimiter: '\\[', type: 'mathBlock' }]);
  });
  it('TeX 花括号错误不能破坏独立公式围栏及相邻正文', () => {
    const value = editor();
    const latex = String.raw`\frac{a}{b`;
    for (const delimiter of ['$$', '\\['] as MathDelimiter[]) {
      const source = writeMath({ latex, delimiter }, true);
      parseMarkdown(value, source + '\n\n保留正文 $x$');
      expect(formulas(value)).toEqual([
        { latex, delimiter, type: 'mathBlock' }, { latex: 'x', delimiter: '$', type: 'mathInline' },
      ]);
      expect(value.state.doc.textContent).toContain('保留正文');
      expect(serializeMarkdown(value)).toContain(source);
    }
  });
  it('独立围栏支持缩进和 CRLF，忽略内部行尾闭合与注释', () => {
    const value = editor();
    const latex = String.raw`a \]` + '\n' + String.raw`% \]`;
    parseMarkdown(value, '  \\[  \r\n' + latex.replaceAll('\n', '\r\n') + '\r\n  \\] \r\n\r\n后文');
    expect(formulas(value)).toEqual([{ latex, delimiter: '\\[', type: 'mathBlock' }]);
    expect(value.state.doc.textContent).toContain('后文');
  });
  it('未闭合块不借用下一块的围栏，同一行与混合行定界符保持兼容', () => {
    const value = editor();
    parseMarkdown(value, '\\[\n未闭合\n\n\\[\nx\n\\]');
    expect(formulas(value)).toEqual([{ latex: 'x', delimiter: '\\[', type: 'mathBlock' }]);
    for (const source of ['\\[x\\]', '\\[\nx\\]', '$$\nx$$']) {
      parseMarkdown(value, source);
      expect(formulas(value)).toEqual([{ latex: 'x', delimiter: source.startsWith('$$') ? '$$' : '\\[', type: 'mathBlock' }]);
    }
  });
});
