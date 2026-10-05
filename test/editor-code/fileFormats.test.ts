import { describe, expect, it } from 'vitest';
import { FILE_FORMATS, getFileFormat, fileExtension } from '../../src/core/fileFormats';
import { kindFromPath, languageFromPath } from '../../src/core/docKind';
import { ALL_DOCUMENT_KINDS, ALL_LANGUAGE_IDS } from '../../src/core/ipc/types';

describe('shared file capabilities', () => {
  it('has unique names and valid kind/language contracts', () => {
    for (const field of ['id', 'extensions', 'filenames', 'prefixes'] as const) {
      const values = FILE_FORMATS.flatMap(format => field === 'id' ? [format.id] : [...(format[field] ?? [])]);
      expect(new Set(values).size).toBe(values.length);
      expect(values.every(value => value === value.toLowerCase())).toBe(true);
    }
    for (const format of FILE_FORMATS) {
      expect(ALL_DOCUMENT_KINDS).toContain(format.kind);
      expect(ALL_LANGUAGE_IDS).toContain(format.language);
      if (format.preview === 'delimited') expect([',', '\t']).toContain(format.delimiter);
    }
  });

  it.each([
    ['C:\\project\\.ENV.PRODUCTION', 'code', 'ini'],
    ['/repo/Dockerfile.release', 'code', 'dockerfile'],
    ['/repo/Containerfile.dev', 'code', 'dockerfile'],
    ['/repo/Gemfile', 'code', 'ruby'],
    ['/repo/data.geojson', 'code', 'json'],
    ['/repo/notebook.ipynb', 'code', 'json'],
    ['/repo/Info.plist', 'code', 'xml'],
    ['/repo/component.vue', 'code', 'html'],
    ['/repo/vector.svg', 'image', 'xml'],
    ['/repo/design.PSD', 'unsupported', 'plaintext'],
    ['/repo/scene.blend', 'unsupported', 'plaintext'],
    ['/repo/mesh.obj', 'code', 'plaintext'],
    ['/repo/mesh.stl', 'code', 'plaintext'],
    ['/repo/observations.dat', 'code', 'plaintext'],
    ['/repo/constructor', 'code', 'plaintext'],
    ['/repo/file.__proto__', 'code', 'plaintext'],
  ])('%s selects its opening and syntax behavior', (path, kind, language) => {
    expect(kindFromPath(path)).toBe(kind);
    expect(languageFromPath(path)).toBe(language);
  });

  it('preview capability belongs to the format rather than chosen syntax', () => {
    expect(getFileFormat('page.html').preview).toBe('html');
    expect(getFileFormat('component.vue').preview).toBeUndefined();
    expect(getFileFormat('data.csv').delimiter).toBe(',');
    expect(getFileFormat('data.tsv').delimiter).toBe('\t');
    expect(getFileFormat('drawing.svg').preview).toBe('svg');
    expect(fileExtension('C:\\folder.with.dot\\LICENSE')).toBe('');
  });
});
