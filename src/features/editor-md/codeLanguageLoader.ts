import { createLowlight, type LanguageFn } from 'lowlight';
import { getCodeLanguage, type CodeGrammar } from './codeLanguages';

// Explicit import paths let Vite emit separate grammar chunks. Keep this registry
// out of the picker metadata and out of the synchronous bitable preview bundle.
const loaders: Record<CodeGrammar, () => Promise<{ default: LanguageFn }>> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  dart: () => import('highlight.js/lib/languages/dart'),
  lua: () => import('highlight.js/lib/languages/lua'),
  r: () => import('highlight.js/lib/languages/r'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  sql: () => import('highlight.js/lib/languages/sql'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  xml: () => import('highlight.js/lib/languages/xml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  latex: () => import('highlight.js/lib/languages/latex'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  css: () => import('highlight.js/lib/languages/css'),
};

const embedded: Partial<Record<CodeGrammar, CodeGrammar[]>> = {
  javascript: ['xml', 'css'], typescript: ['xml', 'css'],
  xml: ['javascript', 'css'], markdown: ['xml', 'javascript', 'css'],
  dockerfile: ['bash'],
};
let lowlight: ReturnType<typeof createLowlight> | undefined;
const pending = new Map<CodeGrammar, Promise<void>>();

/** Load just the requested grammar and its embedded languages in this worker. */
export async function loadCodeLanguage(name: string) {
  const grammar = getCodeLanguage(name)?.grammar;
  if (!grammar) return undefined;
  const instance = lowlight ??= createLowlight();
  const load = (id: CodeGrammar): Promise<void> => {
    if (instance.registered(id)) return Promise.resolve();
    let request = pending.get(id);
    if (!request) {
      request = loaders[id]().then(module => { instance.register(id, module.default); })
        .finally(() => pending.delete(id));
      pending.set(id, request);
    }
    return request;
  };
  await Promise.all([grammar, ...(embedded[grammar] ?? [])].map(load));
  return { lowlight: instance, grammar };
}
