import { expect, it } from 'vitest';
import { resolveRelativeDocPath } from '../../src/core/documentPath';
it('导出和编辑共用文件路径解析，保留 UNC 与字面百分号', () => {
  expect(resolveRelativeDocPath('C:/notes', 'img/test%20a.png')).toBe('C:\\notes\\img\\test a.png');
  expect(resolveRelativeDocPath('C:/notes', '../100%.png')).toBe('C:\\100%.png');
  expect(resolveRelativeDocPath('', 'file:///C:/notes/a.png')).toBe('C:\\notes\\a.png');
  expect(resolveRelativeDocPath('', 'file://server/share/a.png')).toBe('\\\\server\\share\\a.png');
});
