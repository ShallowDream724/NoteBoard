import { expect, it, vi } from 'vitest';
import { highlightCode } from '../../src/features/editor-md/codeHighlighting';
import { codeTokensToHTML } from '../../src/features/editor-md/codeTokens';
import { tokenizeCode } from '../../src/features/editor-md/codeHighlightEngine';
import { CODE_LANGUAGES, normalizeLanguage, searchCodeLanguages } from '../../src/features/editor-md/codeLanguages';
import { loadCodeLanguage } from '../../src/features/editor-md/codeLanguageLoader';

it('代码高亮保留源码字符，已知语言着色，未知语言不猜测', async () => {
  const source = 'const text = "<b>hello</b>"; // comment';
  const tokens = await tokenizeCode(source, 'javascript');
  const element = document.createElement('code'); element.innerHTML = codeTokensToHTML(source, tokens);
  expect(element.textContent).toBe(source);
  expect(element.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(await highlightCode(source, 'not-a-language')).toEqual([]);
});

it.each([
  ['python3', 'def greet(name):\n    return "hello"'],
  ['php', '<?php echo "hello";'],
  ['rb', 'def greet(name)\n  puts "hello"\nend'],
  ['swift', 'let name: String = "hello"'],
  ['kt', 'fun main() { println("hello") }'],
  ['dart', 'void main() { print("hello"); }'],
  ['pwsh', 'function Say-Hello { Write-Output "hello" }'],
  ['lua', 'local name = "hello"'],
  ['r', 'if (TRUE) print("hello")'],
  ['matlab', 'function y = square(x)\ny = x^2;\nend'],
  ['toml', '[server]\nport = 8080\nenabled = true'],
  ['dockerfile', 'FROM node:22\nRUN echo "hello"'],
  ['ini', '[server]\nport=8080'],
  ['tex', '\\documentclass{article}\n\\begin{document}Hello\\end{document}'],
])('%s loads its real grammar and preserves source text', async (language, source) => {
  const tokens = await tokenizeCode(source, language);
  expect(tokens.length).toBeGreaterThan(0);
  const element = document.createElement('code'); element.innerHTML = codeTokensToHTML(source, tokens);
  expect(element.textContent).toBe(source);
  expect(element.querySelector('[class^="hljs-"]')).not.toBeNull();
});

it('uses one canonical option per language while retaining aliases for search and fences', () => {
  expect(new Set(CODE_LANGUAGES.map(language => language.value)).size).toBe(CODE_LANGUAGES.length);
  for (const [alias, canonical] of [['py3', 'python'], ['pwsh', 'powershell'], ['shell', 'bash'], ['tex', 'latex'], ['kt', 'kotlin']]) {
    expect(normalizeLanguage(alias)).toBe(canonical);
    expect(searchCodeLanguages(alias).map(language => language.value)).toContain(canonical);
  }
  expect(CODE_LANGUAGES.some(language => String(language.value) === 'shell')).toBe(false);
});

it('skips unsupported and oversized code without loading a grammar', async () => {
  expect(await tokenizeCode('const x = 1', 'unsupported')).toEqual([]);
  expect(await tokenizeCode('x'.repeat(200_001), 'python')).toEqual([]);
});

it('propagates parser failures so the worker cannot cache them as ready empty tokens', async () => {
  const source = 'def greet():\n    return "hello"';
  const loaded = await loadCodeLanguage('python');
  const highlight = vi.spyOn(loaded!.lowlight, 'highlight').mockImplementationOnce(() => { throw new Error('Parser failed'); });
  try {
    await expect(tokenizeCode(source, 'python')).rejects.toThrow('Parser failed');
    expect((await tokenizeCode(source, 'python')).some(token => token.className === 'hljs-keyword')).toBe(true);
  } finally { highlight.mockRestore(); }
});

it('returns a stable plain-code fallback when the token budget is exceeded', async () => {
  expect(await tokenizeCode('1 '.repeat(16_385), 'python')).toEqual([]);
});
