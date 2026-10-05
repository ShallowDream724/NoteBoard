import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_LIMIT_MESSAGE, MANUAL_ANALYSIS_MAX_CHARS, XML_MAX_CHARS,
  analyzeText, expandJsonText, minifyJsonText, validateJsonText, validateXmlText,
} from '../../src/features/editor-code/textAnalysis';

describe('JSON token transformations', () => {
  it('保留大整数、重复键、指数、负零与原字符串转义', () => {
    const source = '{ "n":9007199254740993,"n":1e400,"zero":-0,"s":"\\u0061\\/" }';
    const compact = '{"n":9007199254740993,"n":1e400,"zero":-0,"s":"\\u0061\\/"}';
    expect(minifyJsonText(source)).toBe(compact);
    expect(minifyJsonText(expandJsonText(source, 4))).toBe(compact);
  });

  it('空对象/数组、字符串内标点和转义反斜杠保持正确', () => {
    const source = '[{},[],"[ } \\\\" , {"a":true}]';
    expect(validateJsonText(source).valid).toBe(true);
    const formatted = expandJsonText(source);
    expect(JSON.parse(formatted)).toEqual(JSON.parse(source));
    expect(formatted).toContain('{}');
    expect(formatted).toContain('[]');
  });

  it('无效文本位置计入开头空白', () => {
    const validation = validateJsonText('   {bad:1}');
    expect(validation.valid).toBe(false);
    expect(validation.errorPos).toBe(4);
  });

  it('深层 JSON 展开在输出上限前停止，避免平方级输出', () => {
    const source = '['.repeat(4000) + '1' + ']'.repeat(4000);
    expect(() => expandJsonText(source)).toThrow(ANALYSIS_LIMIT_MESSAGE);
  });

  it('超过手动输入上限直接拒绝', () => {
    expect(() => minifyJsonText(' '.repeat(MANUAL_ANALYSIS_MAX_CHARS + 1))).toThrow(ANALYSIS_LIMIT_MESSAGE);
  });
});

describe('YAML grammar diagnostics', () => {
  it('引用字符串、块文字与值分隔符中的 Tab 不误报', async () => {
    const result = await analyzeText({ language: 'yaml', operation: 'validate', text: 'quoted: "a\tb"\nblock: |\n  \tcontent\nkey:\tvalue\n' });
    expect(result.issues).toEqual([]);
  });

  it('定位 Tab 缩进且语法不闭合得到真实解析错误', async () => {
    const result = await analyzeText({ language: 'yaml', operation: 'validate', text: 'parent:\n\tchild: 1\narray: [1, 2' });
    expect(result.issues?.some(issue => issue.from === 8 && issue.message.includes('缩进'))).toBe(true);
    expect(result.issues?.some(issue => issue.message.includes('语法错误'))).toBe(true);
  });

  it('大量错误仅保留有限诊断', async () => {
    const result = await analyzeText({ language: 'yaml', operation: 'validate', text: '\tkey: value\n'.repeat(2000) });
    expect(result.issues?.length).toBeLessThanOrEqual(100);
  });
});

describe('XML parser diagnostics', () => {
  it.each(['<a/><b/>', '<a x="1" x="2"/>', '<a>&undefined;</a>', '<a><b></a>', '<a><!-- unterminated</a>'])('检测真正的 XML 错误: %s', (source) => {
    expect(validateXmlText(source).valid).toBe(false);
  });

  it('注释与 CDATA 中的假标签不被当成元素', () => {
    expect(validateXmlText('<root><!-- <fake> --><![CDATA[<wrong>]]><value a="a > b"/></root>').valid).toBe(true);
  });

  it('保守 DOMParser 输入上限明确拒绝', () => {
    expect(validateXmlText(' '.repeat(XML_MAX_CHARS + 1)).error).toBe(ANALYSIS_LIMIT_MESSAGE);
  });

  it('含 DTD 的实体展开不能绕过资源上限，且不作为语法错误误报', () => {
    const result = validateXmlText('<!DOCTYPE root [<!ENTITY a "value">]><root>&a;</root>');
    expect(result.unsupported).toBe(true);
    expect(result.error).toContain('外部');
  });

  it('CDATA 与注释里的 DOCTYPE 字面量仍然合法', () => {
    expect(validateXmlText('<root><!-- <!DOCTYPE fake> --><![CDATA[<!DOCTYPE fake>]]></root>').valid).toBe(true);
  });
});
