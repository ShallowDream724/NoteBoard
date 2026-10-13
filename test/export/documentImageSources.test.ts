import { expect, it, vi } from 'vitest';
import { resolveDocumentImageSource, validateDocumentImageAsset } from '../../src/core/documentImageSource';
import { documentParser } from '../../src/features/editor-md/documentExtensions';
import { renderDocument } from '../../src/features/export/renderDocument';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';

const remoteSources = [String.raw`\\server\share\photo.png`, '//server/share/photo.png',
  'file://server/share/photo.png', 'file:////server/share/photo.png',
  '%5c%5cserver%5cshare%5cphoto.png', '%255c%255cserver%255cshare%255cphoto.png',
  '%2f%2fserver/share/photo.png', '%5c%5cserver%5cshare%5cphoto%ZZ.png',
  String.raw`\\?\UNC\server\share\photo.png`, String.raw`\??\UNC\server\share\photo.png`,
  'asset://localhost/%5c%5cserver%5cshare%5cphoto.png',
  'asset://localhost/%255c%255cserver%255cshare%255cphoto.png',
  'http://asset.localhost/%5c%5cserver%5cshare%5cphoto.png',
  'https://asset.localhost/%2f%2fserver/share/photo.png',
  'http://asset.localhost./%5c%5cserver%5cshare%5cphoto.png',
  'asset://server/share/photo.png', 'file://server/share/%5cphoto.png',
];

it.each(remoteSources)('blocks authored remote reference %s before native conversion', source => {
  for (const base of ['', 'C:/notes', String.raw`\\trusted\private\notes`]) {
    expect(resolveDocumentImageSource(source, base).kind).toBe('blocked');
  }
});

it('retains local paths, local asset URLs, inline images and ordinary web images', () => {
  expect(resolveDocumentImageSource('', String.raw`\\server\share\notes`)).toEqual({ kind: 'url', url: '' });
  for (const source of ['C:/notes/a.png', 'file:///C:/notes/a.png', 'file://localhost/C:/notes/a.png',
    'asset://localhost/C%3A%5Cnotes%5Ca.png', 'http://asset.localhost/C%3A%5Cnotes%5Ca.png']) {
    expect(resolveDocumentImageSource(source)).toEqual({ kind: 'file', path: 'C:\\notes\\a.png' });
  }
  expect(resolveDocumentImageSource('images/a%20b.png', 'C:/notes')).toEqual({ kind: 'file', path: 'C:\\notes\\images\\a b.png' });
  expect(resolveDocumentImageSource('http://asset.localhost/C%3A%5Cnotes%5Ca%23b%3Fc.png')).toEqual({ kind: 'file', path: 'C:\\notes\\a#b?c.png' });
  for (const source of ['https://example.com/a.png', 'data:image/png;base64,AQID', 'blob:https://noteboard/id']) {
    expect(resolveDocumentImageSource(source)).toEqual({ kind: 'url', url: source });
  }
});

it('allows relative images only within an explicitly opened UNC share, including traversal and extended base paths', () => {
  for (const base of [String.raw`\\server\share\notes`, '//server/share/notes', String.raw`\\?\UNC\server\share\notes`]) {
    expect(resolveDocumentImageSource('../images/a.png', base)).toEqual({ kind: 'file', path: String.raw`\\server\share\images\a.png` });
    expect(resolveDocumentImageSource('../../../../a.png', base)).toEqual({ kind: 'file', path: String.raw`\\server\share\a.png` });
  }
  expect(validateDocumentImageAsset(String.raw`\\server\share\notes\a.png`, './a.png', String.raw`\\server\share\notes`)).toBe(true);
  expect(validateDocumentImageAsset(String.raw`\\other\share\a.png`, './a.png', String.raw`\\server\share\notes`)).toBe(false);
  expect(validateDocumentImageAsset(String.raw`\\server\share\a.png`)).toBe(false);
  for (const source of [String.raw`\\SERVER\Share\images\a.png`, 'file://server/share/images/a.png',
    'http://asset.localhost/%5c%5cserver%5cshare%5cimages%5ca.png']) {
    expect(resolveDocumentImageSource(source, String.raw`\\server\share\notes`)).toEqual({ kind: 'file', path: String.raw`\\server\share\images\a.png` });
  }
  for (const source of [String.raw`\\server\share-other\a.png`, String.raw`\\server-other\share\a.png`,
    String.raw`\\server\other\a.png`, String.raw`\\?\UNC\server\share\a.png`]) {
    expect(resolveDocumentImageSource(source, String.raw`\\server\share\notes`).kind).toBe('blocked');
  }
  expect(resolveDocumentImageSource(String.raw`\\server\share\..\..\a.png`, String.raw`\\server\share\notes`)).toEqual({ kind: 'file', path: String.raw`\\server\share\a.png` });
  expect(resolveDocumentImageSource(String.raw`\\server\share\\\evil\other\a.png`, String.raw`\\server\share\notes`)).toEqual({ kind: 'file', path: String.raw`\\server\share\evil\other\a.png` });
  expect(resolveDocumentImageSource('%5c%5cserver%5cshare%5c%5c%5cevil%5cother%5ca.png', String.raw`\\server\share\notes`)).toEqual({ kind: 'file', path: String.raw`\\server\share\evil\other\a.png` });
  expect(resolveDocumentImageSource(String.raw`\\server\share\C:\outside\a.png`, String.raw`\\server\share\notes`).kind).toBe('blocked');
});

it('fails closed for device aliases, nested encoding and control-character URL normalization', () => {
  for (const source of [String.raw`\\.\UNC\server\share\a.png`, 'file://server\n/share/a.png',
    'http:\\\\asset.localhost\\%5c%5cserver%5cshare%5ca.png',
    '%25255c%25255cserver/share/a.png',
    'asset://localhost/relative.png', 'javascript:alert(1)']) {
    expect(resolveDocumentImageSource(source, 'C:/notes').kind).toBe('blocked');
  }
});

it.each(['print', 'html'] as const)('exports %s placeholders without mapping or retaining remote source attributes', async mode => {
  const schema = documentParser().schema;
  const doc = schema.nodeFromJSON({ type: 'doc', content: remoteSources.map(src => ({ type: 'image', attrs: { src, alt: 'original' } })) });
  const map = vi.fn((paths: string[]) => paths);
  const before = doc.toJSON();
  const output = await renderDocument('', 'blocked', 'C:/notes', undefined, doc, undefined, map, mode);
  const root = document.createElement('div'); root.innerHTML = output.html;
  expect(root.querySelectorAll('img')).toHaveLength(0);
  expect(root.querySelectorAll('.export-image-blocked')).toHaveLength(remoteSources.length);
  expect(map).not.toHaveBeenCalled(); expect(doc.toJSON()).toEqual(before);
});

it('passes original relative provenance to the host for allowed network-directory exports', async () => {
  const schema = documentParser().schema;
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'image', attrs: { src: './a.png' } }] });
  const map = vi.fn((paths: string[]) => paths.map(() => 'data:image/png;base64,AQID'));
  const output = await renderDocument('', 'shared', String.raw`\\server\share\notes`, undefined, doc, undefined, map);
  expect(map).toHaveBeenCalledExactlyOnceWith([String.raw`\\server\share\notes\a.png`], ['./a.png']);
  expect(output.html).toContain('data:image/png;base64,AQID');
});

it('keeps a shared document image usable after native save rebases its relative reference', () => {
  const schema = documentParser().schema, directory = String.raw`\\server\share\notes`;
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'image', attrs: { src: './assets/a.png' } }] });
  const reopened = parseNativeNode(serializeNativeNode(doc, directory), schema);
  expect(doc.firstChild!.attrs.src).toBe('./assets/a.png');
  expect(reopened.firstChild!.attrs.src).toBe('//server/share/notes/assets/a.png');
  expect(resolveDocumentImageSource(reopened.firstChild!.attrs.src, directory)).toEqual({ kind: 'file', path: String.raw`\\server\share\notes\assets\a.png` });
  expect(resolveDocumentImageSource(reopened.firstChild!.attrs.src, 'C:/notes').kind).toBe('blocked');
});

it('keeps blocked images out of the Pandoc AST before the external writer can read them', () => {
  const schema = documentParser().schema;
  const doc = schema.nodeFromJSON({ type: 'doc', content: remoteSources.map(src => ({ type: 'image', attrs: { src } })) });
  const output = pandocSource(doc, 'C:/notes');
  expect(output).not.toContain('"t":"Image"'); expect(output).toContain('网络共享图片未自动加载');
  const permitted = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'image', attrs: { src: '../assets/a.png' } },
    { type: 'image', attrs: { src: String.raw`\\server\share\assets\a.png` } }] });
  const ast = JSON.parse(pandocSource(permitted, String.raw`\\server\share\notes`));
  expect(ast.blocks.map((block: { c: { c: unknown[] }[] }) => block.c[0].c[2])).toEqual([
    [String.raw`\\server\share\assets\a.png`, ''], [String.raw`\\server\share\assets\a.png`, ''],
  ]);
});
