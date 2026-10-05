import catalog from './fileFormats.json' with { type: 'json' };
import type { DocumentKind, LanguageId } from './ipc/types';

/** File behavior metadata only. Icons, grammars and viewers have separate owners. */
export interface FileFormat {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly language: LanguageId;
  readonly extensions?: readonly string[];
  readonly filenames?: readonly string[];
  readonly prefixes?: readonly string[];
  readonly preview?: 'html' | 'delimited' | 'svg';
  readonly delimiter?: ',' | '\t';
}

export const FILE_FORMATS: readonly FileFormat[] = catalog as readonly FileFormat[];
const byExtension = new Map<string, FileFormat>();
const byFilename = new Map<string, FileFormat>();
const prefixes: Array<readonly [string, FileFormat]> = [];
for (const format of FILE_FORMATS) {
  for (const ext of format.extensions ?? []) byExtension.set(ext, format);
  for (const name of format.filenames ?? []) byFilename.set(name, format);
  for (const prefix of format.prefixes ?? []) prefixes.push([prefix, format]);
}
prefixes.sort((a, b) => b[0].length - a[0].length);
const textFallback: FileFormat = Object.freeze({ id: 'text-candidate', kind: 'code', language: 'plaintext' });

export function fileBasename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
}

export function fileExtension(path: string): string {
  const name = fileBasename(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot + 1);
}

export function getFileFormatByExtension(extension: string): FileFormat {
  return byExtension.get(extension.toLowerCase()) ?? textFallback;
}

/** Exact filenames and filename families take precedence; no per-path cache. */
export function getFileFormat(path: string): FileFormat {
  const name = fileBasename(path);
  return byFilename.get(name) ?? prefixes.find(([prefix]) => name.startsWith(prefix))?.[1]
    ?? getFileFormatByExtension(fileExtension(name));
}

// Retain the old public maps for callers; all are now derived from one catalog.
export const KIND_BY_EXT: Readonly<Record<string, DocumentKind>> = Object.freeze(Object.fromEntries(
  [...byExtension].map(([ext, format]) => [ext, format.kind]),
));
export const LANGUAGE_BY_EXT: Readonly<Record<string, LanguageId>> = Object.freeze(Object.fromEntries(
  [...byExtension].map(([ext, format]) => [ext, format.language]),
));
export const LANGUAGE_BY_FILENAME: Readonly<Record<string, LanguageId>> = Object.freeze(Object.fromEntries(
  [...byFilename].map(([name, format]) => [name, format.language]),
));
