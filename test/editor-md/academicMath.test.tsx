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
});
