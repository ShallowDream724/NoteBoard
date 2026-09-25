import { Node, type Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { editorSupportsCapability, runWithDocumentCapability } from '../document-format/featureGate';

export type TableStyle = 'standard' | 'three-line';
export const tableStyle = (value: unknown): TableStyle => value === 'three-line' ? value : 'standard';
const NAME = 'documentPresentation';
const PREFIX = '<!-- noteboard-document ';

export function documentTableStyle(doc: DocumentNode): TableStyle {
  return doc.firstChild?.type.name === NAME ? tableStyle(doc.firstChild.attrs.tableStyle) : 'standard';
}
export function setDocumentTableStyle(editor: Editor, value: TableStyle) {
  if (value !== 'standard' && !editorSupportsCapability(editor, 'tableStyle')) { runWithDocumentCapability(editor, 'tableStyle', next => setDocumentTableStyle(next, value)); return; }
  const { doc, tr } = editor.state;
  if (documentTableStyle(doc) === value) return;
  if (doc.firstChild?.type.name === NAME) {
    if (value === 'standard') tr.delete(0, doc.firstChild.nodeSize);
    else tr.setNodeMarkup(0, undefined, { tableStyle: value });
  } else tr.insert(0, editor.schema.nodes[NAME].create({ tableStyle: value }));
  editor.view.dispatch(tr);
}

/** One metadata node, not root document attributes: changing root attributes
 * makes ProseMirror recreate all NodeViews. Normal transactions/history retain
 * every content subtree while the container's CSS attribute controls painting. */
export const DocumentPresentation = Node.create({
  name: NAME, group: 'block', atom: true, selectable: false,
  addAttributes() { return { tableStyle: { default: 'standard' } }; },
  parseHTML() { return [{ tag: 'span[data-document-presentation]', getAttrs: element => ({ tableStyle: tableStyle(element.getAttribute('data-table-style')) }) }]; },
  renderHTML({ node }) { return ['span', { 'data-document-presentation': '', 'data-table-style': tableStyle(node.attrs.tableStyle), style: 'display:none', 'aria-hidden': 'true' }]; },
  markdownTokenizer: {
    name: NAME, level: 'block',
    start: source => source.startsWith(PREFIX) ? 0 : -1,
    tokenize(source) {
      if (!source.startsWith(PREFIX)) return undefined;
      const end = source.indexOf('-->'); if (end < 0 || end > 1024) return undefined;
      try {
        const value = JSON.parse(source.slice(PREFIX.length, end));
        if (value.version === 1 && ['standard', 'three-line'].includes(value.tableStyle)) return { type: NAME, raw: source.slice(0, end + 3), tableStyle: value.tableStyle };
      } catch { /* Unknown comments remain ordinary input. */ }
      return undefined;
    },
  },
  parseMarkdown(token, helpers) { return helpers.createNode(NAME, { tableStyle: tableStyle(token.tableStyle) }); },
  renderMarkdown(node) { return `${PREFIX}${JSON.stringify({ version: 1, tableStyle: tableStyle(node.attrs?.tableStyle) })} -->`; },
  addKeyboardShortcuts() {
    const atDocumentStart = () => {
      const { doc, selection } = this.editor.state, { $from } = selection;
      return selection.empty && $from.depth === 1 && $from.parentOffset === 0
        && doc.firstChild?.type.name === NAME && $from.before(1) === doc.firstChild.nodeSize;
    };
    return { Backspace: atDocumentStart, 'Mod-Backspace': atDocumentStart };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ props: { attributes: state => ({ 'data-table-style': documentTableStyle(state.doc) }) } })];
  },
});
