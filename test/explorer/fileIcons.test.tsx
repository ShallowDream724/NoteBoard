// NoteBoard 文件图标映射单元测试

import { describe, test, expect } from 'vitest';
import { getFileIcon } from '@/components/FileIcon';
import React from 'react';

describe('fileIcons 优雅文件格式图标体系测试', () => {
  test('文件夹返回文件夹图标', () => {
    const closedFolder = getFileIcon('src', { isDir: true, isOpen: false });
    expect(React.isValidElement(closedFolder)).toBe(true);

    const openFolder = getFileIcon('src', { isDir: true, isOpen: true });
    expect(React.isValidElement(openFolder)).toBe(true);
  });

  test('图片格式返回对应优雅图标', () => {
    const pngIcon = getFileIcon('logo.png');
    const jpgIcon = getFileIcon('photo.jpg');
    const gifIcon = getFileIcon('anim.gif');
    const webpIcon = getFileIcon('preview.webp');
    const icoIcon = getFileIcon('favicon.ico');
    const svgIcon = getFileIcon('vector.svg');
    const bmpIcon = getFileIcon('pic.bmp');

    expect(React.isValidElement(pngIcon)).toBe(true);
    expect(React.isValidElement(jpgIcon)).toBe(true);
    expect(React.isValidElement(gifIcon)).toBe(true);
    expect(React.isValidElement(webpIcon)).toBe(true);
    expect(React.isValidElement(icoIcon)).toBe(true);
    expect(React.isValidElement(svgIcon)).toBe(true);
    expect(React.isValidElement(bmpIcon)).toBe(true);
  });

  test('数据与配置文件格式返回专属图标', () => {
    const sqlIcon = getFileIcon('query.sql');
    const jsonIcon = getFileIcon('data.json');
    const yamlIcon = getFileIcon('config.yaml');
    const ymlIcon = getFileIcon('config.yml');
    const xmlIcon = getFileIcon('schema.xml');
    const txtIcon = getFileIcon('notes.txt');
    const mdIcon = getFileIcon('README.md');
    const boardIcon = getFileIcon('diagram.board');

    expect(React.isValidElement(sqlIcon)).toBe(true);
    expect(React.isValidElement(jsonIcon)).toBe(true);
    expect(React.isValidElement(yamlIcon)).toBe(true);
    expect(React.isValidElement(ymlIcon)).toBe(true);
    expect(React.isValidElement(xmlIcon)).toBe(true);
    expect(React.isValidElement(txtIcon)).toBe(true);
    expect(React.isValidElement(mdIcon)).toBe(true);
    expect(React.isValidElement(boardIcon)).toBe(true);
  });
});
