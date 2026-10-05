import type { LanguageId } from '../../core/ipc/types';
import { ANALYSIS_LIMIT_MESSAGE, ANALYSIS_OUTPUT_MAX_CHARS, XML_OUTPUT_MAX_CHARS, expandJsonText, parseXmlText } from './textAnalysis';

export { minifyJsonText, expandJsonText, validateJsonText } from './textAnalysis';

export function formatJson(source: string): string {
  const output = expandJsonText(source);
  if (output.length >= ANALYSIS_OUTPUT_MAX_CHARS) throw new Error(ANALYSIS_LIMIT_MESSAGE);
  return output + '\n';
}

interface XmlLeaf { start: number; end: number; kind: 'text' | 'markup' }
interface XmlElement {
  start: number;
  end: number;
  openEnd: number;
  closeStart: number;
  preserve: boolean;
  mixed: boolean;
  parts: XmlPart[];
}
type XmlPart = XmlLeaf | XmlElement;

/** XML validation precedes source-token layout. Never reserializes XML values. */
export function formatXml(source: string): string {
  const { validation, document } = parseXmlText(source);
  if (!validation.valid) throw new Error(validation.error);
  const elements = document!.getElementsByTagName('*');
  let elementIndex = 0;
  const roots: XmlPart[] = [];
  const stack: XmlElement[] = [];
  const add = (part: XmlPart) => (stack.length ? stack[stack.length - 1].parts : roots).push(part);
  for (let index = 0; index < source.length;) {
    const start = index;
    if (source[index] !== '<') {
      const next = source.indexOf('<', index);
      index = next < 0 ? source.length : next;
      const text = source.slice(start, index);
      if (stack.length && text.trim()) stack[stack.length - 1].mixed = true;
      add({ start, end: index, kind: 'text' });
      continue;
    }
    if (source.startsWith('<!--', index) || source.startsWith('<![CDATA[', index) || source.startsWith('<?', index)) {
      const cdata = source.startsWith('<![CDATA[', index);
      const ending = cdata ? ']]>' : source.startsWith('<!--', index) ? '-->' : '?>';
      index = source.indexOf(ending, index) + ending.length;
      if (cdata && stack.length) stack[stack.length - 1].mixed = true;
      add({ start, end: index, kind: 'markup' });
      continue;
    }
    // Tags may contain '>' inside either kind of attribute quote.
    let quote = '';
    for (index++; index < source.length; index++) {
      const char = source[index];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') { index++; break; }
    }
    if (source.startsWith('</', start)) {
      const element = stack.pop()!;
      element.closeStart = start;
      element.end = index;
    } else {
      const xmlSpace = elements[elementIndex++].getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space');
      const inherited = stack.length ? stack[stack.length - 1].preserve : false;
      const element: XmlElement = {
        start, end: index, openEnd: index, closeStart: index,
        preserve: xmlSpace === 'preserve' || (xmlSpace !== 'default' && inherited),
        mixed: false, parts: [],
      };
      add(element);
      if (!source.slice(start, index).endsWith('/>')) {
        stack.push(element);
        if (stack.length > 256) throw new Error('XML 层级过深，请选择较小片段或使用外部工具');
      }
    }
  }
  let outputLength = 0;
  const chunks: string[] = [];
  let buffer = '';
  const append = (value: string): void => {
    outputLength += value.length;
    if (outputLength > XML_OUTPUT_MAX_CHARS) throw new Error(ANALYSIS_LIMIT_MESSAGE);
    buffer += value;
    if (buffer.length >= 8192) { chunks.push(buffer); buffer = ''; }
  };
  const render = (part: XmlPart, depth: number): void => {
    const indent = '  '.repeat(depth);
    if (!('parts' in part)) { append(indent + source.slice(part.start, part.end)); return; }
    if (part.preserve || part.mixed || part.closeStart === part.openEnd) {
      append(indent + source.slice(part.start, part.end)); return;
    }
    const children = part.parts.filter(child => 'parts' in child || child.kind === 'markup');
    if (!children.length) { append(indent + source.slice(part.start, part.end)); return; }
    append(indent + source.slice(part.start, part.openEnd) + '\n');
    children.forEach((child, index) => {
      if (index) append('\n');
      render(child, depth + 1);
    });
    append('\n' + indent + source.slice(part.closeStart, part.end));
  };
  const visibleRoots = roots.filter(part => 'parts' in part || part.kind === 'markup');
  visibleRoots.forEach((part, index) => { if (index) append('\n'); render(part, 0); });
  append('\n');
  if (buffer) chunks.push(buffer);
  return chunks.join('');
}

export function getFormatter(lang: LanguageId): ((source: string) => string) | null {
  return lang === 'json' ? formatJson : lang === 'xml' ? formatXml : null;
}
