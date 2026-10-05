/** Shared, bounded text operations. Formatting keeps JSON tokens verbatim. */
export const AUTO_ANALYSIS_MAX_CHARS = 512 * 1024;
export const SYNC_JSON_MAX_CHARS = 32 * 1024;
export const XML_MAX_CHARS = 256 * 1024;
export const XML_OUTPUT_MAX_CHARS = 1024 * 1024;
export const MANUAL_ANALYSIS_MAX_CHARS = 8 * 1024 * 1024;
export const ANALYSIS_OUTPUT_MAX_CHARS = 8 * 1024 * 1024;
export const ANALYSIS_LIMIT_MESSAGE = '内容过大，请选择较小片段或使用外部工具';

export interface JsonValidationResult {
  valid: boolean;
  error?: string;
  errorPos?: number;
  unsupported?: boolean;
}

export interface TextIssue { from: number; to: number; message: string }
export interface TextAnalysisRequest {
  language: 'json' | 'yaml';
  operation: 'validate' | 'minify' | 'expand';
  text: string;
  tabSize?: number;
}
export interface TextAnalysisResult {
  validation?: JsonValidationResult;
  issues?: TextIssue[];
  output?: string;
  error?: string;
}

export function extractJsonErrorPosition(message: string, text: string): number {
  const position = message.match(/position\s+(\d+)/i);
  if (position) return Math.min(Number(position[1]), text.length);
  const coordinates = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
    ?? message.match(/(?:^|\s)(\d+):(\d+):/);
  if (!coordinates) return 0;
  let offset = 0;
  for (let line = 1; line < Number(coordinates[1]); line++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(0, Number(coordinates[2]) - 1), text.length);
}

export function assertAnalysisSize(text: string, maximum = MANUAL_ANALYSIS_MAX_CHARS): void {
  if (text.length > maximum) throw new Error(ANALYSIS_LIMIT_MESSAGE);
}

export function validateJsonText(text: string): JsonValidationResult {
  if (text.length > MANUAL_ANALYSIS_MAX_CHARS) return { valid: false, error: ANALYSIS_LIMIT_MESSAGE, errorPos: 0 };
  if (!text.trim()) return { valid: false, error: '文本内容为空', errorPos: 0 };
  try {
    JSON.parse(text);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message, errorPos: extractJsonErrorPosition(message, text) };
  }
}

/** Never builds an object to stringify: large integers, duplicate keys and escapes survive. */
function rewriteJson(text: string, tabSize: number | null): string {
  assertAnalysisSize(text);
  const validation = validateJsonText(text);
  if (!validation.valid) throw new Error(validation.error);
  if (tabSize !== null && (!Number.isInteger(tabSize) || tabSize < 1 || tabSize > 10)) {
    throw new Error('缩进必须为 1 到 10 个空格');
  }
  const chunks: string[] = [];
  let buffer = '';
  let length = 0;
  let depth = 0;
  let previous = '';
  const append = (value: string) => {
    if (length + value.length > ANALYSIS_OUTPUT_MAX_CHARS) throw new Error(ANALYSIS_LIMIT_MESSAGE);
    length += value.length;
    buffer += value;
    if (buffer.length >= 8192) { chunks.push(buffer); buffer = ''; }
  };
  const newline = () => {
    const spaces = depth * (tabSize ?? 0);
    // Check before repeat(), so hostile nesting cannot allocate unbounded padding.
    if (length + spaces + 1 > ANALYSIS_OUTPUT_MAX_CHARS) throw new Error(ANALYSIS_LIMIT_MESSAGE);
    append('\n' + ' '.repeat(spaces));
  };
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index++] === '"') break;
      }
      append(text.slice(start, index));
    } else if (char === '{' || char === '[') {
      append(char); index++;
      let next = index;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] !== (char === '{' ? '}' : ']')) {
        depth++;
        if (tabSize !== null) newline();
      }
    } else if (char === '}' || char === ']') {
      if (previous !== (char === '}' ? '{' : '[')) {
        depth--;
        if (tabSize !== null) newline();
      }
      append(char); index++;
    } else if (char === ',') {
      append(char); index++;
      if (tabSize !== null) newline();
    } else if (char === ':') {
      append(tabSize === null ? ':' : ': '); index++;
    } else {
      const start = index++;
      while (index < text.length && !/[\s,\]}]/.test(text[index])) index++;
      append(text.slice(start, index));
    }
    previous = char;
  }
  if (buffer) chunks.push(buffer);
  return chunks.join('');
}

export function minifyJsonText(text: string): string { return rewriteJson(text, null); }
export function expandJsonText(text: string, tabSize = 2): string { return rewriteJson(text, tabSize); }

function containsXmlDoctype(text: string): boolean {
  for (let index = 0; index < text.length;) {
    index = text.indexOf('<', index);
    if (index < 0) return false;
    if (text.startsWith('<!DOCTYPE', index)) return true;
    const ending = text.startsWith('<!--', index) ? '-->'
      : text.startsWith('<![CDATA[', index) ? ']]>' : text.startsWith('<?', index) ? '?>' : null;
    if (ending) {
      const end = text.indexOf(ending, index + 1);
      if (end < 0) return false;
      index = end + ending.length;
    } else index++;
  }
  return false;
}

export function parseXmlText(text: string): { validation: JsonValidationResult; document?: Document } {
  if (text.length > XML_MAX_CHARS) return { validation: { valid: false, error: ANALYSIS_LIMIT_MESSAGE, errorPos: 0 } };
  if (!text.trim()) return { validation: { valid: false, error: '文本内容为空', errorPos: 0 } };
  // Input size alone cannot bound expansion of entities declared in a DTD.
  if (containsXmlDoctype(text)) return { validation: { valid: false, unsupported: true, error: '含 DTD 的 XML 请使用外部校验或格式化工具' } };
  if (typeof DOMParser === 'undefined') return { validation: { valid: false, error: '当前环境无法校验 XML', errorPos: 0 } };
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const error = document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror')[0]
    ?? document.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'parsererror')[0];
  if (error) {
    const message = (error.textContent ?? 'XML 语法错误').slice(0, 500);
    return { validation: { valid: false, error: message, errorPos: extractJsonErrorPosition(message, text) } };
  }
  return { validation: { valid: true }, document };
}

export function validateXmlText(text: string): JsonValidationResult { return parseXmlText(text).validation; }

export async function analyzeText(request: TextAnalysisRequest): Promise<TextAnalysisResult> {
  assertAnalysisSize(request.text);
  if (request.language === 'json') {
    if (request.operation === 'validate') return { validation: validateJsonText(request.text) };
    return { output: request.operation === 'minify'
      ? minifyJsonText(request.text) : expandJsonText(request.text, request.tabSize) };
  }
  const { yamlLanguage } = await import('@codemirror/lang-yaml');
  const tree = yamlLanguage.parser.parse(request.text);
  const issues: TextIssue[] = [];
  const literalRanges: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) {
    if (node.type.isError && issues.length < 100) {
      issues.push({ from: node.from, to: Math.min(request.text.length, Math.max(node.to, node.from + 1)), message: 'YAML 语法错误，请检查此处的结构或引号' });
    }
    if (node.name === 'QuotedLiteral' || node.name === 'BlockLiteralContent' || node.name === 'BlockFoldedContent') {
      literalRanges.push({ from: node.from, to: node.to });
    }
  } });
  // The grammar accepts indentation tabs. Check only indentation outside scalar
  // content; tabs inside quoted values and block scalar text are valid YAML.
  let literal = 0;
  let lineStart = true;
  for (let index = 0; index < request.text.length && issues.length < 100; index++) {
    const char = request.text[index];
    while (literal < literalRanges.length && literalRanges[literal].to <= index) literal++;
    if (lineStart && char === '\t') {
      const range = literalRanges[literal];
      if (!range || index < range.from) issues.push({ from: index, to: index + 1, message: 'YAML 缩进请使用空格' });
    }
    if (char === '\n') lineStart = true;
    else if (char !== ' ' && char !== '\t' && char !== '\r') lineStart = false;
  }
  issues.sort((a, b) => a.from - b.from);
  return { issues };
}
