// Pure metadata shared by the picker, aliases and lazy grammar loader.
// Importing this module never initializes or downloads a syntax grammar.
export const CODE_LANGUAGES = [
  { value: 'plaintext', label: '纯文本', aliases: ['text', 'txt', 'plain', 'chunwenben', 'wb'], grammar: null },
  { value: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'node', 'react'], grammar: 'javascript' },
  { value: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'], grammar: 'typescript' },
  { value: 'python', label: 'Python', aliases: ['py', 'python3', 'py3'], grammar: 'python' },
  { value: 'java', label: 'Java', aliases: ['jvm'], grammar: 'java' },
  { value: 'c', label: 'C', aliases: ['clang'], grammar: 'c' },
  { value: 'cpp', label: 'C++', aliases: ['c++', 'cplusplus', 'cc'], grammar: 'cpp' },
  { value: 'csharp', label: 'C#', aliases: ['c#', 'cs', 'dotnet', '.net'], grammar: 'csharp' },
  { value: 'go', label: 'Go', aliases: ['golang'], grammar: 'go' },
  { value: 'rust', label: 'Rust', aliases: ['rs', 'cargo'], grammar: 'rust' },
  { value: 'php', label: 'PHP', aliases: [], grammar: 'php' },
  { value: 'ruby', label: 'Ruby', aliases: ['rb'], grammar: 'ruby' },
  { value: 'swift', label: 'Swift', aliases: [], grammar: 'swift' },
  { value: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'], grammar: 'kotlin' },
  { value: 'dart', label: 'Dart', aliases: [], grammar: 'dart' },
  { value: 'lua', label: 'Lua', aliases: [], grammar: 'lua' },
  { value: 'r', label: 'R', aliases: ['rscript'], grammar: 'r' },
  { value: 'matlab', label: 'MATLAB', aliases: ['octave'], grammar: 'matlab' },
  { value: 'sql', label: 'SQL', aliases: ['mysql', 'postgres', 'postgresql', 'sqlite', 'oracle'], grammar: 'sql' },
  { value: 'json', label: 'JSON', aliases: [], grammar: 'json' },
  { value: 'yaml', label: 'YAML', aliases: ['yml'], grammar: 'yaml' },
  { value: 'toml', label: 'TOML', aliases: [], grammar: 'ini' },
  { value: 'ini', label: 'INI', aliases: ['cfg', 'conf'], grammar: 'ini' },
  { value: 'xml', label: 'HTML / XML', aliases: ['html', 'xhtml', 'svg'], grammar: 'xml' },
  { value: 'markdown', label: 'Markdown', aliases: ['md'], grammar: 'markdown' },
  { value: 'latex', label: 'LaTeX', aliases: ['tex'], grammar: 'latex' },
  { value: 'bash', label: 'Bash / Shell', aliases: ['sh', 'shell', 'zsh', 'terminal'], grammar: 'bash' },
  { value: 'powershell', label: 'PowerShell', aliases: ['ps', 'ps1', 'pwsh'], grammar: 'powershell' },
  { value: 'dockerfile', label: 'Dockerfile', aliases: ['docker'], grammar: 'dockerfile' },
  { value: 'css', label: 'CSS', aliases: ['scss', 'less', 'style'], grammar: 'css' },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
export type CodeGrammar = Exclude<CodeLanguage['grammar'], null>;

export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  CODE_LANGUAGES.flatMap(language => language.aliases.map(alias => [alias, language.value])),
);
const languages = new Map<string, CodeLanguage>(CODE_LANGUAGES.map(language => [language.value, language]));

/** 规范化语言名（别名 → 标准名） */
export function normalizeLanguage(lang: string | null): string {
  if (!lang || lang.trim() === '') return 'plaintext';
  const normalized = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function getCodeLanguage(language: string): CodeLanguage | undefined {
  return languages.get(normalizeLanguage(language));
}

export function searchCodeLanguages(query: string): readonly CodeLanguage[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CODE_LANGUAGES;
  const terms = (language: CodeLanguage) => [language.value, language.label.toLowerCase(), ...language.aliases];
  return CODE_LANGUAGES.filter(language => terms(language).some(term => term.includes(normalized)))
    .sort((a, b) => Number(terms(b).some(term => term.startsWith(normalized))) - Number(terms(a).some(term => term.startsWith(normalized))));
}

/** highlightAuto 的字符上限 */
export const HIGHLIGHT_AUTO_LIMIT = 5000;

/** 单个代码块高亮的字符上限（超过则跳过） */
export const SINGLE_BLOCK_LIMIT = 20000;

/** Worker 单个代码块的字符上限 */
export const CODE_HIGHLIGHT_LIMIT = 512_000;
