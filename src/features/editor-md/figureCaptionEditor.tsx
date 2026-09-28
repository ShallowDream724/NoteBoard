import { Editor, Node, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { createRoot } from 'react-dom/client';
import { EditorBubbleMenu } from './bubbleMenu';
import { MarkdownHighlight } from './markdownHighlight';
import { TextColor } from '../document-style/documentStyleSchema';
import { figureCaptionContent, validateFigureCaptionContent } from './figureCaption';
import { setFigureCaptionContent } from './figureCaptionCommands';
import { initializeEditorDocument, serializeNativeNode } from './editorDocumentCodec';
import './imageCaption.css';
import { TooltipProvider } from '../../components/Tooltip';
import { dispatchEditorShortcut } from './dispatchEditorShortcut';

const active = new WeakMap<EditorView, () => void>();
let nextHistoryGroup = -1;
const CaptionDocument = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });

/** Only an active caption owns an editor. Its inline transactions immediately
 * become metadata steps in the parent history, preserving table row identities. */
export function mountFigureCaptionEditor(host: HTMLElement, options: {
  view: EditorView; getPos: () => number | undefined; label: string; close: () => void;
}) {
  const { view, getPos } = options;
  host.dataset.editorControl = 'true';
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
  const position = getPos(), original = typeof position === 'number' ? view.state.doc.nodeAt(position) : null;
  const element = document.createElement('div'), menuHost = document.createElement('div');
  host.replaceChildren(element, menuHost);
  let publishing = false, destroyed = false, lastEdit = 0, historyGroup = nextHistoryGroup--;
  const current = () => { const pos = getPos(); return typeof pos === 'number' ? view.state.doc.nodeAt(pos) : null; };
  const captionDocument = (content: JSONContent[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const editor: Editor = new Editor({ element, extensions: [
    StarterKit.configure({ document: false, heading: false, blockquote: false, codeBlock: false, horizontalRule: false,
      bulletList: false, orderedList: false, listItem: false, listKeymap: false, undoRedo: false,
      dropcursor: false, gapcursor: false, trailingNode: false, link: { openOnClick: false }, code: false }),
    CaptionDocument, Code.extend({ excludes: '' }), MarkdownHighlight.configure({ multicolor: true }), TextColor,
  ], content: captionDocument(figureCaptionContent(original?.attrs.caption, original?.attrs.captionContent)),
  editorProps: {
    attributes: { class: 'nb-embedded-prose nb-caption-editor', role: 'textbox', 'aria-label': options.label, 'aria-multiline': 'true', 'data-shortcuts-suspended': 'true' },
    handleScrollToSelection: () => true,
    handleKeyDown: (_inner, event) => {
      if (event.isComposing) return false;
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault(); event.stopPropagation();
        dispatchEditorShortcut(view, event.shiftKey || event.key.toLowerCase() === 'y' ? 'Ctrl+Shift+Z' : 'Ctrl+Z');
        historyGroup = nextHistoryGroup--; lastEdit = 0;
        sync(); return true;
      }
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault(); options.close(); view.dom.focus({ preventScroll: true }); return true;
      }
      if (event.key === 'Enter') return editor.commands.setHardBreak();
      return false;
    },
  }, onUpdate: ({ transaction }) => {
    const pos = getPos(), node = current();
    if (typeof pos !== 'number' || node?.type !== original?.type || (node?.type.name === 'image' && node.attrs.src !== original?.attrs.src)) { options.close(); return; }
    publishing = true;
    const discrete = transaction.steps.some(step => ['addMark', 'removeMark'].includes(step.toJSON().stepType));
    const now = Date.now();
    if (discrete || now - lastEdit > 300) historyGroup = nextHistoryGroup--;
    setFigureCaptionContent(view, pos, editor.getJSON().content?.[0]?.content ?? [], discrete, historyGroup);
    lastEdit = discrete ? 0 : now;
    publishing = false;
  } });
  initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
  editor.registerPlugin(new Plugin({ filterTransaction: tr => {
    if (!tr.docChanged) return true;
    try { validateFigureCaptionContent(tr.doc.firstChild?.toJSON().content ?? []); return true; } catch { return false; }
  } }));
  const root = createRoot(menuHost);
  root.render(<TooltipProvider><EditorBubbleMenu editor={editor} inlineOnly/></TooltipProvider>);
  function sync() {
    if (destroyed || publishing) return;
    const node = current();
    if (!node || node.type !== original?.type) { options.close(); return; }
    const next = editor.schema.nodeFromJSON(captionDocument(figureCaptionContent(node.attrs.caption, node.attrs.captionContent)));
    if (next.eq(editor.state.doc)) return;
    const selection = editor.state.selection;
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content);
    tr.setSelection(TextSelection.create(tr.doc, Math.min(selection.anchor, tr.doc.content.size - 1), Math.min(selection.head, tr.doc.content.size - 1)));
    editor.view.dispatch(tr.setMeta('preventUpdate', true).setMeta('addToHistory', false));
  }
  const outside = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || host.contains(target) || target.closest('[data-caption-toolbar],.nb-highlight-menu')) return;
    options.close();
  };
  const stopKey = (event: Event) => event.stopPropagation();
  active.get(view)?.(); active.set(view, options.close);
  host.addEventListener('keydown', stopKey);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('focusin', outside);
  return { editor, sync, focus() {
    if (destroyed) return;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dom.focus({ preventScroll: true });
  }, destroy() {
    if (destroyed) return; destroyed = true;
    if (active.get(view) === options.close) active.delete(view);
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside);
    host.removeEventListener('keydown', stopKey);
    queueMicrotask(() => { root.unmount(); editor.destroy(); });
    if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
  } };
}
