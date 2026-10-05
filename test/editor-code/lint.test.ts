// NoteBoard lint 测试
// JSON / YAML / XML 语法错误诊断
// 详见 docs/09-开发路线图.md gate:4

import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { getLinterForLanguage, lintTextLanguage } from '../../src/features/editor-code/lint';
import { AUTO_ANALYSIS_MAX_CHARS } from '../../src/features/editor-code/textAnalysis';
import { handleMinifyJson } from '../../src/features/editor-code/jsonOps';
import type { LanguageId } from '../../src/core/ipc/types';

describe('getLinterForLanguage', () => {
  it('json 返回 linter 扩展', () => {
    const ext = getLinterForLanguage('json' as LanguageId);
    expect(ext).not.toBeNull();
  });

  it('yaml 返回 linter 扩展', () => {
    const ext = getLinterForLanguage('yaml' as LanguageId);
    expect(ext).not.toBeNull();
  });

  it('xml 返回 linter 扩展', () => {
    const ext = getLinterForLanguage('xml' as LanguageId);
    expect(ext).not.toBeNull();
  });

  it('plaintext 无 linter', () => {
    const ext = getLinterForLanguage('plaintext' as LanguageId);
    expect(ext).toBeNull();
  });

  it('sql 无 linter', () => {
    const ext = getLinterForLanguage('sql' as LanguageId);
    expect(ext).toBeNull();
  });

  it('markdown 无 linter', () => {
    const ext = getLinterForLanguage('markdown' as LanguageId);
    expect(ext).toBeNull();
  });
});

describe('analysis input boundaries', () => {
  function oversizedView(length: number) {
    const toString = vi.fn(() => { throw new Error('全文不应被读取'); });
    const view = { state: { selection: EditorState.create().selection, doc: { length, toString } } } as unknown as EditorView;
    return { view, toString };
  }
  it('自动 lint 先检查长度，超过512Ki不 flatten 文档', async () => {
    const { view, toString } = oversizedView(AUTO_ANALYSIS_MAX_CHARS + 1);
    expect(await lintTextLanguage(view, 'json')).toEqual([]);
    expect(await lintTextLanguage(view, 'yaml')).toEqual([]);
    expect(toString).not.toHaveBeenCalled();
  });
  it('手动全文操作先检查8Mi上限，不 flatten 文档', () => {
    const { view, toString } = oversizedView(8 * 1024 * 1024 + 1);
    expect(handleMinifyJson(view)).toBe(false);
    expect(toString).not.toHaveBeenCalled();
  });
});
