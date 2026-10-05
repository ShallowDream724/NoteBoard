import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFileTypeIcon, getFileIcon, NoteBoardFileIcon } from '@/components/FileIcon';
import { FILE_ICONS, resolveFileIcon } from '@/core/fileIconCatalog';

describe('shared file icon semantics', () => {
  test.each([
    ['notes.md', 'lang-markdown'], ['notes.MARKDOWN', 'lang-markdown'], ['notes.mdx.tsx', 'lang-markdown'],
    ['photo.PNG', 'image-duo'], ['photo.heic', 'image-duo'], ['animation.gif', 'image-duo'],
    ['vector.svg', 'svg-2'], ['config.json', 'braces'], ['main.mjs', 'lang-javascript-duo'],
    ['main.cts', 'lang-typescript-duo'], ['view.tsx', 'react'], ['index.html', 'lang-html-duo'],
    ['report.log', 'file-text-duo'], ['data.xlsx', 'file-table-duo'], ['query.sqlite3', 'server-duo'],
    ['source.py', 'lang-python'], ['main.go', 'lang-go'], ['main.rs', 'lang-rust'],
    ['shell.ps1', 'bash-duo'], ['source.cpp', 'lang-c'], ['font.woff2', 'font'],
    ['project.nb', 'noteboard'], ['project.nbdoc', 'noteboard'], ['canvas.excalidraw', 'board'],
    ['outline.mindmap', 'mindmap'], ['model.drawio', 'flowchart'], ['records.bitable', 'bitable'],
    ['chart.mmd', 'flowchart'], ['chart.infographic', 'infographic'], ['model.puml', 'mindmap'],
    ['report.pdf', 'document'], ['slides.pptx', 'presentation'], ['formula.tex', 'formula'],
    ['book.epub', 'book'], ['audio.flac', 'audio'], ['movie.mp4', 'video'], ['scene.glb', 'model'],
    ['design.psd', 'design'], ['archive.tar.gz', 'folder-zip-duo'], ['app.apk', 'extension'],
  ])('%s has a stable format identity', (name, symbol) => {
    expect(resolveFileIcon(name).symbol).toBe(symbol);
    expect(resolveFileIcon(`C:\\文件夹\\${name}`)).toBe(resolveFileIcon(`/home/笔记/${name}`));
  });

  test.each([
    ['Dockerfile', 'docker'], ['Containerfile', 'docker'], ['Dockerfile.production', 'docker'],
    ['compose.yaml', 'docker'], ['.gitignore', 'git'], ['.gitattributes', 'git'],
    ['package.json', 'npm-duo'], ['package-lock.json', 'npm-duo'], ['.npmrc', 'npm-duo'],
    ['.env.local', 'gear'], ['.editorconfig', 'gear'], ['CMakeLists.txt', 'gear'],
    ['Gemfile', 'lang-ruby'], ['.bashrc', 'bash-duo'], ['go.mod', 'lang-go'], ['Cargo.toml', 'lang-rust'],
    ['vite.config.ts', 'vite'], ['eslint.config.mjs', 'eslint'], ['.prettierrc.json', 'prettier'],
    ['tailwind.config.js', 'tailwind'], ['next.config.mjs', 'nextjs'], ['webpack.config.js', 'webpack'],
    ['LICENSE', 'file-text-duo'], ['README', 'file-text-duo'],
  ])('%s uses filename semantics before extension semantics', (name, symbol) => {
    expect(resolveFileIcon(name.toUpperCase()).symbol).toBe(symbol);
  });

  test('directory state has precedence over names and extensions', () => {
    expect(resolveFileIcon('package.json', true)).toBe(FILE_ICONS.folder);
    expect(resolveFileIcon('photo.png', true, true)).toBe(FILE_ICONS.folderOpen);
  });

  test('ordinary names, unknown formats and object-property names have safe fallbacks', () => {
    expect(resolveFileIcon('mydockerfile.txt')).toBe(FILE_ICONS.text);
    for (const name of ['unknown.unknown', 'filename', 'constructor', '__proto__', 'a.constructor', 'toString', '.', 'a.']) {
      expect(resolveFileIcon(name)).toBe(FILE_ICONS.file);
    }
  });

  test('tree, tabs and fixed-format actions produce the same SVG reference', () => {
    const Markdown = createFileTypeIcon('note.md');
    expect(renderToStaticMarkup(<Markdown size={14} />)).toBe(renderToStaticMarkup(<>{getFileIcon('README.md')}</>));
    expect(renderToStaticMarkup(<NoteBoardFileIcon size={32} />)).toBe(renderToStaticMarkup(<>{getFileIcon('note.nb', { size: 32 })}</>));
    const markup = renderToStaticMarkup(<>{getFileIcon('photo.png', { size: 18, className: 'detail', style: { opacity: 0.5 } })}</>);
    expect(markup).toContain('width="18"');
    expect(markup).toContain('nb-file-tone-pink detail');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('#image-duo');
    expect(markup).not.toContain('<path');
  });

  test('every catalog reference exists in the bundled sprite, without duplicate IDs', () => {
    const sprites = {
      pierre: readFileSync('src/assets/file-icons.svg', 'utf8'),
      native: readFileSync('src/assets/noteboard-file-icons.svg', 'utf8'),
    };
    const ids = Object.fromEntries(Object.entries(sprites).map(([name, svg]) => {
      const all = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      expect(new Set(all).size).toBe(all.length);
      return [name, new Set(all)];
    }));
    for (const descriptor of Object.values(FILE_ICONS)) {
      expect(ids[descriptor.native ? 'native' : 'pierre'].has(descriptor.symbol), descriptor.symbol).toBe(true);
    }
  });
});
