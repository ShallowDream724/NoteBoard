import { expect, it } from 'vitest';
import { highlightCode, codeTokensToHTML } from '../../src/features/editor-md/codeHighlighting';

it('代码高亮保留源码字符，已知语言着色，未知语言不猜测', async () => {
  const source = 'const text = "<b>hello</b>"; // comment';
  const tokens = await highlightCode(source, 'javascript');
  const element = document.createElement('code'); element.innerHTML = codeTokensToHTML(source, tokens);
  expect(element.textContent).toBe(source);
  expect(element.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(await highlightCode(source, 'not-a-language')).toEqual([]);
});
