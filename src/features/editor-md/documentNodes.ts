// Grammar and document structure only. No React views, stores, IPC or editor lifecycle.
import { Node, mergeAttributes, type MarkdownToken, type MarkdownTokenizer } from '@tiptap/core';
import { findMathStart, readMath, readMathBlock, writeMath, type MathDelimiter, type MathSource } from './mathSyntax';
import { ALERT_META, alertKind, type AlertKind } from './alertPresentation';
import { diagramLanguage, DIAGRAM_LANGUAGES } from './diagramSyntax';

type MathToken = MarkdownToken & MathSource;
const inlineTokenizer: MarkdownTokenizer = {
  name: 'mathInline', level: 'inline', start: findMathStart,
  tokenize(source) {
    const match = readMath(source);
    return match ? { type: 'mathInline', raw: match.raw, latex: match.latex, delimiter: match.delimiter } : undefined;
  },
};
const blockTokenizer: MarkdownTokenizer = {
  name: 'mathBlock', level: 'block',
  start: source => /^ {0,3}(?:\$\$|\\\[)/m.exec(source)?.index ?? -1,
  tokenize(source) {
    const match = readMathBlock(source);
    return match ? { type: 'mathBlock', raw: match.raw, latex: match.latex, delimiter: match.delimiter } : undefined;
  },
};
export function mathSource(attrs: Record<string, unknown> | undefined, block: boolean): MathSource {
  return { latex: String(attrs?.latex ?? ''), delimiter: (attrs?.delimiter ?? (block ? '$$' : '$')) as MathDelimiter };
}
export const MathInlineNode = Node.create({
  name: 'mathInline', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: '' }, delimiter: { default: '$' } }; },
  parseHTML() { return [{ tag: 'span[data-math-inline]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]; },
  renderText({ node }) { return writeMath(mathSource(node.attrs, false)); },
  markdownTokenName: 'mathInline', markdownTokenizer: inlineTokenizer,
  parseMarkdown(token, helpers) { return helpers.createNode('mathInline', mathSource(token as MathToken, false)); },
  renderMarkdown(node) { return writeMath(mathSource(node.attrs, false)); },
});
export const MathBlockNode = Node.create({
  name: 'mathBlock', group: 'block', atom: true, selectable: true,
  addAttributes() { return { latex: { default: '' }, delimiter: { default: '$$' } }; },
  parseHTML() { return [{ tag: 'div[data-math-block]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]; },
  renderText({ node }) { return writeMath(mathSource(node.attrs, true), true); },
  markdownTokenName: 'mathBlock', markdownTokenizer: blockTokenizer,
  parseMarkdown(token, helpers) { return helpers.createNode('mathBlock', mathSource(token as MathToken, true)); },
  renderMarkdown(node) { return writeMath(mathSource(node.attrs, true), true); },
});

export const AlertNode = Node.create({
  name: 'githubAlert', group: 'block', content: 'block+', selectable: true, defining: true,
  addAttributes() {
    return { kind: { default: 'note' as AlertKind,
      parseHTML: element => alertKind(element.getAttribute('data-alert') || element.getAttribute('kind')),
      renderHTML: attributes => ({ 'data-alert': alertKind(attributes.kind) }) } };
  },
  parseHTML() { return [{ tag: 'div[data-alert]', contentElement: element => element.querySelector('.alert-body') ?? element }]; },
  renderHTML({ HTMLAttributes }) {
    const kind = alertKind(HTMLAttributes['data-alert']); const meta = ALERT_META[kind];
    return ['div', mergeAttributes(HTMLAttributes, { class: 'github-alert github-alert-' + kind }),
      ['div', { class: 'alert-title' },
        ['http://www.w3.org/2000/svg svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
        ['http://www.w3.org/2000/svg path', { d: meta.icon }]], ['span', {}, meta.label]],
      ['div', { class: 'alert-body' }, 0]];
  },
  markdownTokenName: 'githubAlert',
  markdownTokenizer: {
    name: 'githubAlert', level: 'block',
    start: source => /^ {0,3}>[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im.exec(source)?.index ?? -1,
    tokenize(source, _tokens, lexer) {
      const header = /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i.exec(source);
      if (!header) return undefined;
      let end = header[0].length; const lines: string[] = [];
      while (end < source.length) {
        const line = /^ {0,3}>[ \t]?([^\r\n]*)(?:\r?\n|$)/.exec(source.slice(end));
        if (!line || /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(line[1])) break;
        lines.push(line[1]); end += line[0].length;
      }
      return { type: 'githubAlert', raw: source.slice(0, end), kind: header[1].toLowerCase(), tokens: lexer.blockTokens(lines.join('\n')) };
    },
  },
  parseMarkdown(token, helpers) {
    const children = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? []);
    return helpers.createNode('githubAlert', { kind: token.kind ?? 'note' }, children.length ? children : [{ type: 'paragraph' }]);
  },
  renderMarkdown(node, helpers) {
    const body = helpers.renderChildren(node.content ?? [], '\n\n');
    return '> [!' + String(node.attrs?.kind ?? 'note').toUpperCase() + ']\n' + body.split('\n').map(line => line ? '> ' + line : '>').join('\n');
  },
});

export const ImageNode = Node.create<{ docKey: string }>({
  name: 'image', group: 'block', inline: false, draggable: true, selectable: true, isolating: true,
  addOptions() { return { docKey: '' }; },
  addAttributes() { return { src: { default: null }, alt: { default: null }, title: { default: null }, width: { default: '100%' }, align: { default: 'center' } }; },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: dom => {
      if (typeof dom === 'string') return {};
      return { src: dom.getAttribute('data-raw-src') || dom.getAttribute('src'), alt: dom.getAttribute('alt'), title: dom.getAttribute('title'),
        width: dom.getAttribute('data-width') || '100%', align: dom.getAttribute('data-align') || 'center' };
    } }];
  },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes({ referrerpolicy: 'no-referrer' }, HTMLAttributes)]; },
  parseMarkdown(token, helpers) { return helpers.createNode('image', { src: token.href, title: token.title, alt: token.text, width: '100%', align: 'center' }); },
  renderMarkdown(node) {
    const { src = '', alt = '', title = '' } = node.attrs ?? {};
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});

function diagramNode(name: string, attribute: string, languages: readonly string[]) {
  return Node.create({
    name, group: 'block', atom: true, selectable: true, isolating: true,
    addAttributes() { return { code: { default: '' } }; },
    parseHTML() { return [{ tag: `div[${attribute}]` }, ...languages.map(language => ({ tag: `pre[data-language="${language}"]` }))]; },
    renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { [attribute]: '' })]; },
    markdownTokenName: 'code',
    parseMarkdown(token, helpers) {
      return diagramLanguage(token.lang) === diagramLanguage(languages[0]) ? helpers.createNode(name, { code: String(token.text ?? '') }) : [];
    },
    renderMarkdown(node) {
      const code = String(node.attrs?.code ?? '');
      // The body may itself contain Markdown fences; choose a longer fence.
      let length = 3;
      for (const run of code.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
      const fence = '`'.repeat(length);
      return `${fence}${languages[0]}\n${code}\n${fence}`;
    },
  });
}
export const MermaidNode = diagramNode('mermaidBlock', 'data-mermaid', DIAGRAM_LANGUAGES.mermaid);
export const PlantUmlNode = diagramNode('plantumlBlock', 'data-plantuml', DIAGRAM_LANGUAGES.plantuml);
export const InfographicNode = diagramNode('infographicBlock', 'data-infographic', DIAGRAM_LANGUAGES.infographic);
