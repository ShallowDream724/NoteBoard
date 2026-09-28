// Native parsers retain folding; StreamLanguage retains lexical state and CM's
// incremental, time-sliced parsing for the remaining code-block languages.
// Every grammar is lazy: startup and the language picker load metadata only.
import type { Extension } from '@codemirror/state';
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { LanguageId } from '../../core/ipc/types';

const stream = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser);
const loaders: Record<LanguageId, () => Promise<Extension>> = {
  markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  yaml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  infographic: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  xml: () => import('@codemirror/lang-xml').then(m => m.xml()),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
  typescript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true, jsx: true })),
  python: () => import('@codemirror/lang-python').then(m => m.python()),
  c: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  php: () => import('@codemirror/lang-php').then(m => m.php()),
  css: () => import('@codemirror/lang-css').then(m => m.css()),
  java: () => import('@codemirror/legacy-modes/mode/clike').then(m => stream(m.java)),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then(m => stream(m.csharp)),
  kotlin: () => import('@codemirror/legacy-modes/mode/clike').then(m => stream(m.kotlin)),
  dart: () => import('@codemirror/legacy-modes/mode/clike').then(m => stream(m.dart)),
  go: () => import('@codemirror/legacy-modes/mode/go').then(m => stream(m.go)),
  rust: () => import('@codemirror/legacy-modes/mode/rust').then(m => stream(m.rust)),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby').then(m => stream(m.ruby)),
  swift: () => import('@codemirror/legacy-modes/mode/swift').then(m => stream(m.swift)),
  lua: () => import('@codemirror/legacy-modes/mode/lua').then(m => stream(m.lua)),
  r: () => import('@codemirror/legacy-modes/mode/r').then(m => stream(m.r)),
  matlab: () => import('@codemirror/legacy-modes/mode/octave').then(m => stream(m.octave)),
  toml: () => import('@codemirror/legacy-modes/mode/toml').then(m => stream(m.toml)),
  ini: () => import('@codemirror/legacy-modes/mode/properties').then(m => stream(m.properties)),
  latex: () => import('@codemirror/legacy-modes/mode/stex').then(m => stream(m.stex)),
  bash: () => import('@codemirror/legacy-modes/mode/shell').then(m => stream(m.shell)),
  powershell: () => import('@codemirror/legacy-modes/mode/powershell').then(m => stream(m.powerShell)),
  dockerfile: () => import('@codemirror/legacy-modes/mode/dockerfile').then(m => stream(m.dockerFile)),
  plaintext: async () => [],
  mermaid: async () => [],
  plantuml: async () => [],
};

const cache = new Map<LanguageId, Promise<Extension>>();

/** A transient chunk failure stays readable and can be retried on the next open. */
export function loadLanguageExtension(lang: LanguageId): Promise<Extension> {
  let pending = cache.get(lang);
  if (!pending) {
    pending = (loaders[lang] ?? loaders.plaintext)().catch(() => {
      cache.delete(lang);
      return [];
    });
    cache.set(lang, pending);
  }
  return pending;
}

export async function loadLanguageFromPath(path: string): Promise<Extension> {
  const { languageFromPath } = await import('../../core/docKind');
  return loadLanguageExtension(languageFromPath(path));
}
