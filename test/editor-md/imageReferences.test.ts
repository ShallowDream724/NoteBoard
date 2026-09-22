import { describe, expect, it } from 'vitest';
import { mayReferenceImage, normalizeImageReferenceText } from '../../src/features/editor-md/imageReferences';

describe('图片引用的保守编码检查', () => {
  it.each(['![x](img/%70icture.png)', '<img src="img/picture&#46;png">',
    '[image]: img/&#x70;icture&period;png', '![x](img/picture\\.png)'])('匹配可加载的文件名：%s', content => {
    expect(mayReferenceImage(normalizeImageReferenceText(content), 'C:\\notes\\img\\picture.png')).toBe(true);
  });
  it.each(['%ff', '&unknown;', '&#128;', '&#xD800;'])('未知编码保留图片：%s', content => {
    expect(normalizeImageReferenceText(content)).toBeNull();
    expect(mayReferenceImage(normalizeImageReferenceText(content), 'picture.png')).toBe(true);
  });
  it('只有已知正文才能证明没有引用', () => {
    expect(mayReferenceImage(normalizeImageReferenceText('普通正文'), 'picture.png')).toBe(false);
  });
});
