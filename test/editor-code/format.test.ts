// NoteBoard 格式化测试
// JSON / XML 格式化
// 详见 docs/09-开发路线图.md gate:4

import { describe, it, expect } from 'vitest';
import { formatJson, formatXml } from '../../src/features/editor-code/format';

describe('formatJson', () => {
  it('格式化简单对象', () => {
    const input = '{"name":"test","value":123}';
    const result = formatJson(input);
    expect(result).toContain('  "name": "test"');
    expect(result).toContain('  "value": 123');
  });

  it('格式化嵌套对象', () => {
    const input = '{"a":{"b":{"c":1}}}';
    const result = formatJson(input);
    expect(result).toContain('"a": {');
    expect(result).toContain('"b": {');
    expect(result).toContain('"c": 1');
  });

  it('格式化数组', () => {
    const input = '[1,2,3]';
    const result = formatJson(input);
    expect(result).toContain('1,');
    expect(result).toContain('2,');
    expect(result).toContain('3');
  });

  it('无效 JSON 应抛出错误', () => {
    expect(() => formatJson('{invalid}')).toThrow();
  });

  it('输出以换行结尾', () => {
    const result = formatJson('{}');
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('formatXml', () => {
  it('格式化简单 XML', () => {
    const input = '<root><child>text</child></root>';
    const result = formatXml(input);
    expect(result).toContain('<root>');
    expect(result).toContain('  <child>');
    expect(result).toContain('  <child>text</child>');
    expect(new DOMParser().parseFromString(result, 'application/xml').querySelector('child')?.textContent).toBe('text');
    expect(result).toContain('</root>');
  });

  it('处理自闭合标签', () => {
    const input = '<root><empty/></root>';
    const result = formatXml(input);
    expect(result).toContain('<root>');
    expect(result).toContain('  <empty/>');
    expect(result).toContain('</root>');
  });

  it('处理处理指令', () => {
    const input = '<?xml version="1.0"?><root/>';
    const result = formatXml(input);
    expect(result).toContain('<?xml');
    expect(result).toContain('<root/>');
  });

  it('混合内容与文字两侧空白原样保留', () => {
    const input = '<root><p> Hello <b>world</b> ! </p><leaf>  value  </leaf></root>';
    const result = formatXml(input);
    expect(result).toContain('<p> Hello <b>world</b> ! </p>');
    expect(result).toContain('<leaf>  value  </leaf>');
  });

  it('保留 CDATA、带尖括号注释和引号属性', () => {
    const input = '<root><!-- <fake> --> <data value="a > b"><![CDATA[ x <tag> ]]></data></root>';
    const result = formatXml(input);
    expect(result).toContain('<!-- <fake> -->');
    expect(result).toContain('<data value="a > b"><![CDATA[ x <tag> ]]></data>');
    expect(new DOMParser().parseFromString(result, 'application/xml').querySelector('data')?.textContent).toBe(' x <tag> ');
  });

  it('保留 xml:space 声明与其子树里的空白', () => {
    const preserved = '<part xml:space="preserve">  <child/> \n <child/> </part>';
    expect(formatXml(`<root>${preserved}<other/></root>`)).toContain(preserved);
  });

  it.each(['<a/><b/>', '<a x="1" x="2"/>', '<a>&undefined;</a>', '<a><b></a>'])('无效 XML 不改写: %s', (source) => {
    expect(() => formatXml(source)).toThrow();
  });

  it('层级与展开输出都有保守上限', () => {
    expect(() => formatXml('<a>'.repeat(257) + '</a>'.repeat(257))).toThrow('层级过深');
    expect(() => formatXml('<a>'.repeat(250) + '<e/>'.repeat(2500) + '</a>'.repeat(250))).toThrow('内容过大');
  });
});
