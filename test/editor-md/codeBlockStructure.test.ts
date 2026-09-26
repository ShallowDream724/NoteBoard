import { describe, expect, it } from 'vitest';
import { getCodeStructure, MAX_CODE_CONTROL_CHARACTERS, MAX_CODE_CONTROL_LINES } from '../../src/features/editor-md/codeBlockStructure';

describe('code block presentation structure', () => {
  it('preserves exact source offsets and a trailing empty line', () => {
    const source = 'const x = "😀";\n\n';
    expect(getCodeStructure(source, 'plaintext')?.lines).toEqual([
      { number: 1, from: 0, to: 15 }, { number: 2, from: 16, to: 16 }, { number: 3, from: 17, to: 17 },
    ]);
  });

  it('folds nested brace scopes while ignoring delimiters in strings and comments', () => {
    const source = 'function outer() {\n  const text = "}"; // {\n  /* } */\n  if (ready) {\n    return /[{}]/;\n  }\n}\n';
    const folds = getCodeStructure(source, 'javascript')!.folds;
    expect(folds.map(fold => [fold.line, fold.endLine])).toEqual([[1, 6], [4, 5]]);
    expect(source.slice(folds[0].from, folds[0].to)).toBe('\n  const text = "}"; // {\n  /* } */\n  if (ready) {\n    return /[{}]/;\n  }');
    expect(source.slice(folds[0].to)).toBe('\n}\n');
  });

  it('folds Python suites without treating docstrings or multiline expressions as dedents', () => {
    const source = 'def greet(name):\n    """hello\nnot a function:\n    """\n    value = (\n0\n    )\n    if name:\n        return name\n\ndef other():\n    pass';
    expect(getCodeStructure(source, 'python')!.folds.map(fold => [fold.line, fold.endLine])).toEqual([[1, 9], [8, 9], [11, 12]]);
  });

  it('limits controls without rewriting source or guessing unsupported language syntax', () => {
    expect(getCodeStructure('x'.repeat(MAX_CODE_CONTROL_CHARACTERS + 1), 'javascript')).toBeNull();
    expect(getCodeStructure('\n'.repeat(MAX_CODE_CONTROL_LINES), 'python')).toBeNull();
    expect(getCodeStructure('custom {\n text\n}', 'plaintext')?.folds).toEqual([]);
    expect(getCodeStructure('function broken() {\n body', 'javascript')?.folds).toEqual([]);
  });

  it('numbers exactly 10000 lines while keeping structural folding bounded separately', () => {
    const source = Array.from({ length: 5000 }, () => 'def f():\n    pass').join('\n');
    const result = getCodeStructure(source, 'python')!;
    expect(result.lines).toHaveLength(10000);
    expect(result.lines.at(-1)?.number).toBe(10000);
    expect(result.folds).toEqual([]);
    expect(getCodeStructure(source + '\n', 'python')).toBeNull();
  });
});
