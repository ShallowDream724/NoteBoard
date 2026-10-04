import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { baseKeymap, toggleMark } from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';
import { history, undo, redo } from '@tiptap/pm/history';
import { splitListItem } from '@tiptap/pm/schema-list';
import { tableEditing } from '@tiptap/pm/tables';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useDocumentStore } from '../../../stores/documentStore';
import { resolveRelativeDocPath } from '../linkHandler';
import { createClipboardImportPlugin } from '../clipboard/clipboardImport';
import { createTableViewportPlugin } from '../tableViewport';
import { EfficientTableView } from '../tableView';
import { createTableRowView } from '../tableRowView';
import { TableCellView } from '../tableCellView';
import { createMediaEditingPlugin } from '../mediaEditing';
import { normalizeImageSlots } from '../imageCaptions';
import { normalizeFigureCaption, renderFigureCaption } from '../figureCaption';

/** The embedded view shares import and table rendering with the main editor,
 * while its history and pending asynchronous work belong only to this draft. */
export function createAnnotationBodyView(host: HTMLElement, editor: Editor, body: ProseMirrorNode, editable: boolean,
  onStateChange?: (state: EditorState) => void): EditorView {
  const schema = editor.schema;
  const bindings = { ...baseKeymap,
    ...(schema.nodes.hardBreak ? { 'Shift-Enter': (state: EditorState, dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void) => {
      if (dispatch) dispatch((state.selection.$from.parent.type.spec.code
        ? state.tr.insertText('\n') : state.tr.replaceSelectionWith(schema.nodes.hardBreak.create())).scrollIntoView());
      return true;
    } } : {}),
    'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo,
    ...(schema.marks.bold ? { 'Mod-b': toggleMark(schema.marks.bold) } : {}),
    ...(schema.marks.italic ? { 'Mod-i': toggleMark(schema.marks.italic) } : {}),
    ...(schema.marks.underline ? { 'Mod-u': toggleMark(schema.marks.underline) } : {}),
    ...(schema.nodes.listItem ? { Enter: splitListItem(schema.nodes.listItem) } : {}),
  };
  const docKey = String(editor.extensionManager.extensions.find(extension => extension.name === 'image')?.options.docKey ?? '');
  const tables = !!schema.nodes.table && !!schema.nodes.tableRow && !!schema.nodes.tableCell;
  const plugins = [
    ...(editable ? [
      createClipboardImportPlugin({ docKey, ownerCurrent: () => !editor.isDestroyed, stripAnnotations: true }),
      createMediaEditingPlugin(), history(), keymap(bindings), keymap(baseKeymap),
      ...(tables ? [tableEditing()] : []),
    ] : []),
    ...(tables ? [createTableViewportPlugin()] : []),
  ];
  const sourceView = (inline: boolean, attribute: string) => (node: ProseMirrorNode) => {
    const dom = document.createElement(inline ? 'code' : 'pre'); dom.textContent = String(node.attrs[attribute] ?? '');
    return { dom };
  };
  const bodyView = new EditorView(host, {
    state: EditorState.create({ schema, doc: normalizeImageSlots(schema.nodes.doc.create(null, body.content)), plugins }),
    editable: () => editable,
    attributes: { class: 'nb-annotation-richtext nb-embedded-prose', 'aria-label': editable ? '说明正文' : '补充说明正文', ...(editable ? { role: 'textbox', 'aria-multiline': 'true', 'data-shortcuts-suspended': 'true' } : {}) },
    dispatchTransaction(tr) {
      bodyView.updateState(bodyView.state.apply(tr));
      onStateChange?.(bodyView.state);
    },
    nodeViews: {
      ...(tables ? {
        table: (node, view) => new EfficientTableView(node, 40, view, { class: 'nb-table' }),
        tableRow: (node, view, getPos, decorations) => createTableRowView(node, view, getPos, decorations),
        tableCell: (node, view, getPos, decorations) => new TableCellView(node, decorations, { view, getPos }),
        tableHeader: (node, view, getPos, decorations) => new TableCellView(node, decorations, { view, getPos }),
      } satisfies NonNullable<ConstructorParameters<typeof EditorView>[1]['nodeViews']> : {}),
      image(node) {
        const figure = document.createElement('figure'); figure.className = 'nb-annotation-image'; figure.contentEditable = 'false';
        const dom = document.createElement('img'); dom.alt = String(node.attrs.alt ?? '');
        const raw = String(node.attrs.src ?? '');
        const base = docKey ? useDocumentStore.getState().getDocument(docKey)?.dirPath : null;
        if (raw && !/^(https?:|data:|blob:|asset:)/i.test(raw) && (base || /^[a-zA-Z]:[\\/]/.test(raw))) {
          try { dom.src = convertFileSrc(base ? resolveRelativeDocPath(base, raw) : raw); } catch { dom.src = raw; }
        } else dom.src = raw;
        dom.loading = 'lazy'; dom.referrerPolicy = 'no-referrer';
        dom.style.maxWidth = '100%'; dom.style.height = 'auto'; dom.style.display = 'block';
        figure.append(dom);
        if (normalizeFigureCaption(node.attrs.caption)) {
          const caption = document.createElement('figcaption'); renderFigureCaption(caption, node.attrs.caption, node.attrs.captionContent); figure.append(caption);
        }
        return { dom: figure };
      },
      annotationStore() { const dom = document.createElement('span'); dom.hidden = true; return { dom }; },
      mathInline: sourceView(true, 'latex'), mathBlock: sourceView(false, 'latex'),
      mermaidBlock: sourceView(false, 'code'), plantumlBlock: sourceView(false, 'code'), infographicBlock: sourceView(false, 'code'),
    },
  });
  return bodyView;
}

/** Keep viewport/plugin ownership when the parent updates an open read panel. */
export function updateAnnotationBodyView(view: EditorView, body: ProseMirrorNode): void {
  if (view.state.doc.content.eq(body.content)) return;
  view.updateState(EditorState.create({ schema: view.state.schema, doc: normalizeImageSlots(view.state.schema.nodes.doc.create(null, body.content)), plugins: view.state.plugins }));
}
