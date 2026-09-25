import { Extension, Mark, type Editor } from '@tiptap/core';
import { documentColor } from './colors';
import type { TextStylePair } from './stylePreference';
import type { Transaction } from '@tiptap/pm/state';
import { editorSupportsCapability, runWithDocumentCapability } from '../document-format/featureGate';

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
    { types: ['paragraph', 'heading'], attributes: {
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
export function setTextColor(editor: Editor, color: string | null): boolean {
  if (color && !editorSupportsCapability(editor, 'textColor')) return runWithDocumentCapability(editor, 'textColor', next => setTextColor(next, color));
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  const styled = color && documentColor(color) ? chain.setMark('textColor', { color }) : chain.unsetMark('textColor');
  return styled.command(({ tr }) => { styleMathBlocks(tr, { color }); return true; }).run();
}
export function styleMathBlocks(tr: Transaction, change: Partial<TextStylePair>, from = tr.selection.from, to = tr.selection.to) {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'mathBlock') return;
    const attrs = { ...node.attrs };
    if (change.color !== undefined) attrs.textColor = documentColor(change.color);
    if (change.background !== undefined) attrs.background = documentColor(change.background);
    tr.setNodeMarkup(pos, undefined, attrs);
  });
}
export function setHighlightColor(editor: Editor, color: string | null): boolean {
  if (color && !editorSupportsCapability(editor, 'highlight')) return runWithDocumentCapability(editor, 'highlight', next => setHighlightColor(next, color));
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  const styled = color ? chain.setHighlight({ color }) : chain.unsetHighlight();
  return styled.command(({ tr }) => { styleMathBlocks(tr, { background: color }); return true; }).run();
}
export function applyTextStyle(editor: Editor, pair: TextStylePair): boolean {
  if ((pair.color || pair.background) && !editorSupportsCapability(editor, 'textColor')) return runWithDocumentCapability(editor, 'textColor', next => applyTextStyle(next, pair));
  const color = documentColor(pair.color), background = documentColor(pair.background);
  let chain = editor.chain().focus(undefined, { scrollIntoView: false });
  chain = color ? chain.setMark('textColor', { color }) : chain.unsetMark('textColor');
  chain = background ? chain.setHighlight({ color: background }) : chain.unsetHighlight();
  return chain.command(({ tr }) => { styleMathBlocks(tr, pair); return true; }).run();
}
export function setParagraphPresentation(editor: Editor, change: { textAlign?: 'left'|'center'|'right'; indentBy?: number }): boolean {
  if (!editorSupportsCapability(editor, 'alignment')) return runWithDocumentCapability(editor, 'alignment', next => setParagraphPresentation(next, change));
  const { state } = editor, tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (!['paragraph','heading'].includes(node.type.name)) return;
    const attrs = { ...node.attrs };
    if (change.textAlign) attrs.textAlign = change.textAlign;
    if (change.indentBy) attrs.indent = Math.max(0, Math.min(8, (attrs.indent || 0) + change.indentBy));
    tr.setNodeMarkup(pos, undefined, attrs);
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr); editor.view.focus(); return true;
}
