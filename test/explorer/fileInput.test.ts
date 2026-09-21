import { expect, it } from 'vitest';
import { normalizeFileInput } from '../../src/features/welcome/fileInput';
it.each([
  ['C:/notes/math.md', 'C:\\notes\\math.md'],
  [' C:\\notes\\math.md ', 'C:\\notes\\math.md'],
  ['"C:/研究 笔记/公式.md"', 'C:\\研究 笔记\\公式.md'],
  ['file:///C:/notes/a%20b.md', 'C:\\notes\\a b.md'],
  ['file://server/share/a.md', '\\\\server\\share\\a.md'],
  ['//server/share/a.md', '\\\\server\\share\\a.md'],
  ['\\\\?\\C:\\notes\\a.md', '\\\\?\\C:\\notes\\a.md'],
])('路径入口 %s', (input, expected) => expect(normalizeFileInput(input)).toBe(expected));
it.each(['https://example.test/a.md', 'relative.md', 'C:/bad\nname.md'])('不把非文件输入当作本地路径 %s', (input) => {
  expect(() => normalizeFileInput(input)).toThrow();
});
