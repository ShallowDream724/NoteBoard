import { Extension, Mark } from '@tiptap/core';
import { documentColor } from './colors';
import { INDENT_BLOCK_TYPES } from './selectionPresentation';

// Shared with parser workers; keep editor commands and UI dependencies outside this module.
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() { return { color: { default: null } }; },
  parseHTML() { return [{ tag: 'span[data-text-color]', getAttrs: node => ({ color: documentColor(node.getAttribute('data-text-color')) }) }]; },
  renderHTML({ mark }) { const color = documentColor(mark.attrs.color); return ['span', color ? { 'data-text-color': color, style: `color:${color};print-color-adjust:exact` } : {}, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node); },
});
export const BlockPresentation = Extension.create({
  name: 'blockPresentation',
  addGlobalAttributes() { return [
    { types: ['mathBlock'], attributes: Object.fromEntries(['textColor', 'background'].map(key => [key, {
      default: null,
      parseHTML: (element: HTMLElement) => documentColor(key === 'textColor' ? element.style.color : element.style.backgroundColor),
      renderHTML: (attrs: Record<string, unknown>) => documentColor(attrs[key]) ? { style: `${key === 'textColor' ? 'color' : 'background-color'}:${documentColor(attrs[key])};print-color-adjust:exact` } : {},
    }])) },
    { types: ['paragraph', 'heading'], attributes: {
      textAlign: { default: null,
        parseHTML: element => ['left','center','right'].includes(element.style.textAlign) ? element.style.textAlign : null,
        renderHTML: attrs => ['left','center','right'].includes(attrs.textAlign) ? { style: `text-align:${attrs.textAlign}` } : {} },
    } },
    { types: INDENT_BLOCK_TYPES, attributes: {
      indent: { default: 0,
        parseHTML: element => Math.max(0, Math.min(8, Number(element.getAttribute('data-indent')) || 0)),
        renderHTML: attrs => Number.isInteger(attrs.indent) && attrs.indent > 0 && attrs.indent <= 8 ? { 'data-indent': attrs.indent, style: `margin-inline-start:${attrs.indent * 2}em` } : {} },
    } },
    { types: ['tableCell', 'tableHeader'], attributes: {
      verticalAlign: { default: null,
        parseHTML: element => ['top','middle','bottom'].includes(element.style.verticalAlign) ? element.style.verticalAlign : null,
        renderHTML: attrs => ['top','middle','bottom'].includes(attrs.verticalAlign) ? { style: `vertical-align:${attrs.verticalAlign}` } : {} },
    } },
  ]; },
});
