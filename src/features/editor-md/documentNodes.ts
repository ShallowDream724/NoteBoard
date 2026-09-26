// Grammar and document structure only. No React views, stores, IPC or editor lifecycle.
import { Node, mergeAttributes, type MarkdownToken, type MarkdownTokenizer } from '@tiptap/core';
import { findMathStart, readMath, readMathBlock, writeMath, type MathDelimiter, type MathSource } from './mathSyntax';
import { alertKind, type AlertKind } from './alertPresentation';
import { diagramLanguage, DIAGRAM_LANGUAGES } from './diagramSyntax';
import { currentParagraph } from './markdownLexer';
import { calloutAttributes, calloutEmoji, calloutStyleText, calloutSvgIcon, calloutTitle, isAlertKind, isCalloutColor, isCalloutIcon, isCalloutTitle } from './calloutPresentation';
import { figureCaptionDOM, figureCaptionText, markdownFigureCaption, normalizeFigureCaption, parseFigureCaptionContent, validateFigureCaption, validateFigureCaptionContent } from './figureCaption';

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
  start: source => /^ {0,3}(?:\$\$|\\\[)/m.exec(currentParagraph(source))?.index ?? -1,
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
    const color = (attribute: string) => ({ default: null, validate: (value: unknown) => { if (!isCalloutColor(value)) throw new RangeError('Invalid callout color'); },
      parseHTML: (element: HTMLElement) => { const value = element.getAttribute(attribute); return isCalloutColor(value) ? value : null; },
      rendered: false });
    return { kind: { default: 'note' as AlertKind,
      validate: (value: unknown) => { if (!isAlertKind(value)) throw new RangeError('Invalid callout kind'); },
      parseHTML: element => alertKind(element.getAttribute('data-alert') || element.getAttribute('kind')),
      renderHTML: attributes => ({ 'data-alert': alertKind(attributes.kind) }) },
      title: { default: null, rendered: false, validate: (value: unknown) => { if (!isCalloutTitle(value)) throw new RangeError('Invalid callout title'); },
        parseHTML: element => { const value = element.getAttribute('data-callout-title'); return isCalloutTitle(value) ? value : null; } },
      icon: { default: null, rendered: false, validate: (value: unknown) => { if (!isCalloutIcon(value)) throw new RangeError('Invalid callout icon'); },
        parseHTML: element => { const value = element.getAttribute('data-callout-icon'); return isCalloutIcon(value) ? value : null; } },
      textColor: color('data-callout-text-color'), borderColor: color('data-callout-border-color'), backgroundColor: color('data-callout-background-color'),
    };
  },
  parseHTML() { return [{ tag: 'div[data-alert]', contentElement: element => element.querySelector('.alert-body') ?? element }]; },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = calloutAttributes(node.attrs), title = calloutTitle(attrs), emoji = calloutEmoji(attrs);
    return ['div', mergeAttributes(HTMLAttributes, { class: 'github-alert github-alert-' + attrs.kind,
      'data-callout-title': attrs.title, 'data-callout-icon': attrs.icon, 'data-callout-text-color': attrs.textColor,
      'data-callout-border-color': attrs.borderColor, 'data-callout-background-color': attrs.backgroundColor,
      'data-callout-colored-text': attrs.textColor || attrs.backgroundColor ? '' : null,
      style: calloutStyleText(attrs) }),
      ['span', { class: 'callout-icon', 'aria-hidden': 'true' }, ...(emoji ? [emoji] : [
        ['http://www.w3.org/2000/svg svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
        ['http://www.w3.org/2000/svg path', { d: calloutSvgIcon(attrs) }]]])],
      ...(title ? [['div', { class: 'alert-title' }, title]] : []),
      ['div', { class: 'alert-body' }, 0]];
  },
  markdownTokenName: 'githubAlert',
  markdownTokenizer: {
    name: 'githubAlert', level: 'block',
    start: source => /^ {0,3}>[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im.exec(currentParagraph(source))?.index ?? -1,
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
    const attrs = calloutAttributes(node.attrs), emoji = calloutEmoji(attrs);
    const escape = (value: string) => value.replace(/[\\`*_[\]<>]/g, '\\$&');
    const title = attrs.title === null ? '' : attrs.title;
    const heading = [emoji, title].filter(Boolean).map(escape).join(' ');
    const content = [heading ? '**' + heading + '**' : '', body].filter(Boolean).join('\n\n');
    return '> [!' + attrs.kind.toUpperCase() + ']\n' + content.split('\n').map(line => line ? '> ' + line : '>').join('\n');
  },
});

export const ImageNode = Node.create<{ docKey: string }>({
  name: 'image', group: 'block', inline: false, draggable: true, selectable: true, isolating: true,
  addOptions() { return { docKey: '' }; },
  addAttributes() { return { src: { default: null }, alt: { default: null }, title: { default: null }, width: { default: '100%' }, align: { default: 'center' },
    caption: { default: null, rendered: false, validate: validateFigureCaption },
    captionContent: { default: null, rendered: false, validate: validateFigureCaptionContent } }; },
  parseHTML() {
    const attributes = (dom: HTMLElement) => {
      const image = dom.matches('img') ? dom : dom.querySelector('img');
      if (!image) return false;
      const captionDOM = dom.matches('figure') ? dom.querySelector('figcaption') : null;
      const captionContent = parseFigureCaptionContent(captionDOM);
      return { src: image.getAttribute('data-raw-src') || image.getAttribute('src'), alt: image.getAttribute('alt'), title: image.getAttribute('title'),
        width: dom.getAttribute('data-width') || image.getAttribute('data-width') || image.getAttribute('width') || '100%',
        align: dom.getAttribute('data-align') || image.getAttribute('data-align') || image.getAttribute('align') || 'center',
        caption: captionContent ? figureCaptionText(captionContent) : normalizeFigureCaption(captionDOM?.textContent), captionContent };
    };
    return [{ tag: 'figure[data-nb-image]', getAttrs: attributes }, { tag: 'img[src]', getAttrs: attributes }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const caption = normalizeFigureCaption(node.attrs.caption);
    const rawWidth = String(node.attrs.width ?? '100%');
    const width = /^(?:\d+(?:\.\d+)?)(?:%|px)$/.test(rawWidth) ? rawWidth : /^\d+(?:\.\d+)?$/.test(rawWidth) ? `${rawWidth}px` : '100%';
    const align = node.attrs.align === 'left' || node.attrs.align === 'right' ? node.attrs.align : 'center';
    const imageAttrs = { ...HTMLAttributes }; delete imageAttrs.width; delete imageAttrs.align;
    return ['figure', { 'data-nb-image': '', 'data-width': node.attrs.width, 'data-align': align,
      style: `width:${width};max-width:100%;margin:16px ${align === 'right' ? '0' : 'auto'} 16px ${align === 'left' ? '0' : 'auto'}` },
      ['img', mergeAttributes({ referrerpolicy: 'no-referrer' }, imageAttrs, { style: 'display:block;width:100%;max-width:100%;height:auto' })],
      ...(caption ? [['figcaption', { 'data-nb-caption-content': node.attrs.captionContent ? JSON.stringify(node.attrs.captionContent) : null,
        style: 'margin-top:6px;font-size:.85em;line-height:1.6;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere' }, ...figureCaptionDOM(caption, node.attrs.captionContent)]] : [])];
  },
  parseMarkdown(token, helpers) { return helpers.createNode('image', { src: token.href, title: token.title, alt: token.text, width: '100%', align: 'center' }); },
  renderMarkdown(node, helpers) {
    const { src = '', alt = '', title = '' } = node.attrs ?? {};
    const image = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    const caption = markdownFigureCaption(node.attrs?.caption, node.attrs?.captionContent, content => helpers.renderChildren(content));
    return caption ? `${image}\n\n${caption}` : image;
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
