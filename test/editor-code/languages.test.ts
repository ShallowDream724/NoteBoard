import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { CODE_LANGUAGES } from '@/core/codeLanguages';
import { LANGUAGE_BY_EXT, LANGUAGE_BY_FILENAME, languageFromPath, kindFromPath } from '@/core/docKind';
import type { LanguageId } from '@/core/ipc/types';
import { loadLanguageExtension } from '@/features/editor-code/languages';
import { createBaseExtensions } from '@/features/editor-code/setup';

const samples: Partial<Record<LanguageId, string>> = {
  javascript: 'const answer = "hello";', typescript: 'const answer: number = 42;',
  python: 'def greet(name):\n    return "hello"\n', c: 'int main(void) { return 42; }', cpp: 'class Example { public: int value = 42; };',
  java: 'public class Example { int value = 42; }', csharp: 'public class Example { int value = 42; }',
  go: 'package main\nfunc main() { println("hello") }', rust: 'fn main() { let value = 42; }',
  php: '<?php echo "hello"; ?>', ruby: 'def greet\n  puts "hello"\nend', swift: 'let message = "hello"',
  kotlin: 'val message = "hello"', dart: 'void main() { print("hello"); }', lua: 'local value = 42', r: 'value <- 42',
  matlab: 'function y = test(x)\ny = 42;\nend', sql: 'SELECT * FROM users WHERE id = 42;', json: '{"value":42}',
  yaml: 'value: true', toml: '[server]\nport = 42', ini: '[server]\nport=42', xml: '<item value="42"/>',
  markdown: '# Hello\n**world**', latex: '\\section{Hello}', bash: 'echo "hello"', powershell: 'Write-Host "hello"',
  dockerfile: 'FROM alpine\nRUN echo hello', css: '.title { color: red; }',
};

describe('code file languages', () => {
  it('classifies every registered language through shared extension or filename metadata', () => {
    const values = new Set([...Object.values(LANGUAGE_BY_EXT), ...Object.values(LANGUAGE_BY_FILENAME)]);
    for (const language of CODE_LANGUAGES) expect(values.has(language.value), language.value).toBe(true);
    for (const [ext, language] of Object.entries(LANGUAGE_BY_EXT)) expect(languageFromPath(`C:\\code\\sample.${ext.toUpperCase()}`)).toBe(language);
    for (const [filename, language] of Object.entries(LANGUAGE_BY_FILENAME)) expect(languageFromPath(`/code/${filename.toUpperCase()}`)).toBe(language);
    expect(languageFromPath('build/Dockerfile')).toBe('dockerfile');
    expect(languageFromPath('script.m')).toBe('matlab');
    expect(languageFromPath('header.h')).toBe('c');
    expect(languageFromPath('unknown.zzz')).toBe('plaintext');
    expect(kindFromPath('vector.svg')).toBe('image');
    expect(kindFromPath('notes.nb')).toBe('noteboard');
    expect(kindFromPath('schema.drawio')).toBe('drawio');
    expect(languageFromPath('report.html')).toBe('html');
  });

  it.each(Object.entries(samples))('renders syntax tokens for %s with its loaded file grammar', async (language, doc) => {
    const extension = await loadLanguageExtension(language as LanguageId);
    const state = EditorState.create({ doc, extensions: [extension] });
    const tree = ensureSyntaxTree(state, doc.length, 1000);
    expect(tree, language).not.toBeNull();
    const tokens: string[] = [];
    highlightTree(tree!, classHighlighter, (from, to, classes) => tokens.push(`${classes}:${doc.slice(from, to)}`));
    expect(tokens.length, language).toBeGreaterThan(0);
  });

  it.each(['python', 'cpp', 'go'] as const)('keeps the initial and edited 10k-line %s parse bounded', async language => {
    const doc = `${samples[language]}\n`.repeat(10_000);
    let state = EditorState.create({ doc, extensions: [await loadLanguageExtension(language)] });
    expect(syntaxTree(state).length).toBeLessThan(doc.length);
    state = state.update({ changes: { from: 0, insert: '\n' } }).state;
    expect(syntaxTree(state).length).toBeLessThan(doc.length);
    expect(ensureSyntaxTree(state, 100, 1000)).not.toBeNull();
    expect(state.doc.length).toBe(doc.length + 1);
  });

  it('uses Chinese labels for the built-in go-to-line dialog', () => {
    const state = EditorState.create({ extensions: createBaseExtensions() });
    expect(state.phrase('Go to line')).toBe('跳转到行');
    expect(state.phrase('go')).toBe('跳转');
  });
});
