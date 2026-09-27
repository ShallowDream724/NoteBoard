import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { CellSelection, isInTable } from '@tiptap/pm/tables';
import { documentSliceClipboardData, mergeImportedAnnotationBodies, parseStructuredClipboard, withoutNestedAnnotations } from './structured';
import { DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME } from './constants';
import { captureVisualInsertion, captureVisualImageInsertion, captureDocumentInsertion, insertViewImages, type InsertedImage, type InsertionLease } from '../imageInsertionLease';
import { handlePastedImageFiles, handleImageFilesUsingLease, handleImagePathsUsingLease } from '../imagePaste';
import { registerNativeFileDropTarget, isNativeFileDropDuplicate } from '../../../core/editor/fileDropTargets';
import { createImageDropIndicator, imageDropTargetAtPoint, trackImagePastePointer } from '../imageDropTarget';
import { getMdTipTapEditor } from '../editorInstances';
import { useWindowStore } from '../../../stores/windowStore';
import { insertTableSlice, customClipboardTextSerializer } from '../tableClipboard';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { showToast } from '../../../stores/toastStore';
import { CLIPBOARD_LIMITS, ClipboardImportError, type ClipboardImportResult } from './normalize';
import { clipboardHtmlSource, MARKDOWN_MIMES, needsClipboardImageFallback, normalizeExternalHtml, normalizeExternalText, type ExternalTextOptions } from './external';
import { ensureContainerTail } from '../containerEditing';
import { imageOnlySlice, imageInsertionTransaction, imageSlotPosition } from '../imageInsertionTransaction';

export { DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME } from './constants';
export { documentSliceClipboardData } from './structured';
export type ClipboardChoice = 'table' | 'document' | 'html' | 'images' | 'text' | 'markdown';
export function chooseClipboardFormat(types: readonly string[], plain = false): ClipboardChoice {
  if (plain) return 'text';
  if (types.includes(TABLE_SELECTION_MIME)) return 'table';
  if (types.includes(DOCUMENT_SLICE_MIME)) return 'document';
  if (MARKDOWN_MIMES.some(type => types.includes(type))) return 'markdown';
  if (types.includes('text/html')) return 'html';
  if (types.some(type => type.startsWith('image/')) || types.includes('Files')) return 'images';
  return 'text';
}
interface ImportedSlice { slice: Slice; bodies: PMNode[]; diagnostics: string[]; tableScope?: ClipboardImportResult['tableScope'] }
export interface ClipboardTiming { characters: number; responseMs: number; normalizationMs: number; materializationMs: number; commitMs: number; completionMs: number; asynchronous: boolean }
let lastTiming: ClipboardTiming | null = null;
/** Devtools/tests read response and completed synchronous commit separately. */
export function clipboardImportTiming(): ClipboardTiming | null { return lastTiming; }
const pendingKey = new PluginKey<DecorationSet>('clipboardImport');
const plainRequests = new WeakSet<ClipboardEvent>();
const taskYield = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export interface ClipboardSnapshot { formats: Record<string, string>; files?: File[] }
/** Context-menu reads use exactly the same classifier/importer as a native paste. */
export function importClipboardSnapshot(view: EditorView, snapshot: ClipboardSnapshot, plain = false): boolean {
  const event = { clipboardData: { types: [...Object.keys(snapshot.formats), ...(snapshot.files?.length ? ['Files'] : [])], files: snapshot.files ?? [], items: [], getData: (type: string) => snapshot.formats[type] ?? '' }, preventDefault() {} } as unknown as ClipboardEvent;
  if (plain) plainRequests.add(event);
  const handled = view.someProp('handleDOMEvents', handlers => handlers.paste?.(view, event));
  if (handled) return true;
  const html = snapshot.formats['text/html'], text = snapshot.formats['text/plain'];
  if (!plain && html) return view.pasteHTML(html, event);
  return text ? view.pasteText(text, event) : false;
}

function supportedNode(schema: Schema, value: JSONContent, children: PMNode[]): PMNode {
  if (value.type === 'text') {
    if (typeof value.text !== 'string' || !value.text) throw new ClipboardImportError('剪贴板文本节点无效');
    return schema.text(value.text, (value.marks ?? []).map(mark => schema.markFromJSON(mark)));
  }
  const type = value.type && schema.nodes[value.type];
  if (!type) throw new ClipboardImportError(`剪贴板包含不支持的内容类型：${value.type ?? '未知'}`);
  const marks = (value.marks ?? []).map(mark => schema.markFromJSON(mark));
  return type.createChecked(value.attrs, children, marks);
}
/** Bottom-up materialization yields by elapsed time, including inside a single large table. */
export async function materializeClipboard(content: JSONContent[], schema: Schema, signal?: AbortSignal): Promise<PMNode[]> {
  const output: PMNode[] = [], stack = content.slice().reverse().map(value => ({ value, parent: output, depth: 0, ready: false, children: [] as PMNode[] }));
  let count = 0, deadline = performance.now() + 8;
  while (stack.length) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const frame = stack.pop()!;
    if (!frame.ready) {
      if (++count > CLIPBOARD_LIMITS.nodes || frame.depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构超过导入限制');
      frame.ready = true; stack.push(frame);
      const children = frame.value.content ?? [];
      for (let index = children.length - 1; index >= 0; index--) stack.push({ value: children[index], parent: frame.children, depth: frame.depth + 1, ready: false, children: [] });
    } else frame.parent.push(supportedNode(schema, frame.value, frame.children));
    if (performance.now() >= deadline) { await taskYield(); deadline = performance.now() + 8; }
  }
  return output;
}
function synchronousNodes(content: JSONContent[], schema: Schema): PMNode[] {
  let count = 0;
  const make = (value: JSONContent, depth: number): PMNode => {
    if (++count > CLIPBOARD_LIMITS.nodes || depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构超过导入限制');
    return supportedNode(schema, value, (value.content ?? []).map(child => make(child, depth + 1)));
  };
  return content.map(value => make(value, 0));
}
export function insertImportedSlice(view: EditorView, imported: ImportedSlice, selection: Selection, imagePosition?: number): boolean {
  const images = imageOnlySlice(imported.slice);
  if (images && imageSlotPosition(view.state, imagePosition ?? selection.from) !== undefined) {
    const { tr } = imageInsertionTransaction(view.state, images, selection, imagePosition);
    mergeImportedAnnotationBodies(tr, imported.bodies);
    dispatchDiscreteEdit(view, tr); view.focus(); return true;
  }
  const tr = view.state.tr.setSelection(selection).replaceSelection(imported.slice);
  ensureContainerTail(tr, selection.from);
  mergeImportedAnnotationBodies(tr, imported.bodies);
  dispatchDiscreteEdit(view, tr.scrollIntoView()); view.focus(); return true;
}
function imported(nodes: PMNode[], diagnostics: string[], openStart?: number, openEnd?: number, tableScope?: ClipboardImportResult['tableScope']): ImportedSlice {
  const body: PMNode[] = [], bodies: PMNode[] = [];
  for (const node of nodes) { if (node.type.name === 'annotationStore') node.forEach(child => bodies.push(child)); else body.push(node); }
  const fragment = Fragment.from(body);
  return { slice: openStart === undefined ? Slice.maxOpen(fragment, false) : new Slice(fragment, openStart, openEnd ?? 0), bodies, diagnostics, tableScope };
}
function plainSlice(text: string, schema: Schema): Slice {
  const content = text.replace(/\r\n?/g, '\n').split('\n').map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
  return new Slice(Fragment.from(content), 1, 1);
}
/** Menu callers explicitly choose this path to bypass both rich content and table inference. */
export function insertClipboardPlainText(view: EditorView, text: string): boolean {
  if (!text) return false;
  const tr = view.state.tr;
  if (view.state.selection.$from.parent.type.spec.code || (view.state.storedMarks ?? view.state.selection.$from.marks()).some(mark => mark.type.name === 'code')) tr.insertText(text.replace(/\r\n?/g, '\n'));
  else tr.replaceSelection(plainSlice(text, view.state.schema));
  dispatchDiscreteEdit(view, tr); return true;
}
function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'));
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap(item => { const file = item.type.startsWith('image/') ? item.getAsFile() : null; return file ? [file] : []; });
}

/** Body/button paste has no native editor event. Claim only an image-only rich
 * payload, keeping the same normalization and insertion as a focused editor. */
function smallClipboardImages(view: EditorView, data: DataTransfer): ImportedSlice | undefined {
  const own = data.getData(DOCUMENT_SLICE_MIME), html = data.getData('text/html');
  const raw = own || html;
  if (!raw || raw.length > CLIPBOARD_LIMITS.synchronous || data.getData(TABLE_SELECTION_MIME)) return;
  const normalized = own ? parseStructuredClipboard(raw) : normalizeExternalHtml(new DOMParser().parseFromString(clipboardHtmlSource(raw), 'text/html'), raw, data.getData('text/plain'));
  const value = imported(synchronousNodes(normalized.content, view.state.schema), normalized.diagnostics, own ? normalized.openStart : undefined, own ? normalized.openEnd : undefined);
  return imageOnlySlice(value.slice) ? value : undefined;
}

export function writeDocumentClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  if (!event.clipboardData || view.state.selection.empty || view.state.selection instanceof CellSelection) return false;
  const slice = view.state.selection.content();
  const serialized = view.serializeForClipboard(slice);
  event.clipboardData.setData(DOCUMENT_SLICE_MIME, documentSliceClipboardData(view.state.doc, slice));
  event.clipboardData.setData('text/html', serialized.dom.innerHTML);
  event.clipboardData.setData('text/plain', customClipboardTextSerializer(slice, view));
  event.preventDefault(); if (cut) dispatchDiscreteEdit(view, view.state.tr.deleteSelection()); return true;
}

function workerNormalize(raw: string, kind: Exclude<ClipboardChoice, 'images'>, signal: AbortSignal, stripAnnotations = false, textOptions: ExternalTextOptions & { plainText?: string } = {}): Promise<ClipboardImportResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./clipboard.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('已取消', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { finish(); if (event.data.ok) resolve(event.data.result); else reject(new ClipboardImportError(event.data.error)); };
    worker.onerror = event => { finish(); reject(new ClipboardImportError(event.message || '剪贴板解析失败')); };
    worker.postMessage({ raw, kind, stripAnnotations, ...textOptions });
  });
}

export interface ClipboardImportAdapter {
  docKey: string;
  /** Main-editor integration retains its registered TipTap ownership contract. */
  editor?: Editor;
  /** Embedded draft validity (parent editor/body identity), evaluated before commits. */
  ownerCurrent?: () => boolean;
  stripAnnotations?: boolean;
}
/** One paste coordinator for both the main editor and lightweight embedded views. */
export function createClipboardImportPlugin(adapter: ClipboardImportAdapter): Plugin<DecorationSet> {
    const { editor, docKey, stripAnnotations = false } = adapter;
    let attachedView: EditorView | null = null;
    const targets = new Set<{ map(tr: Transaction): void; cancel(): void }>();
    function capture<T>(view: EditorView, insert: (value: T, selection: Selection, position?: number) => boolean, position?: number): InsertionLease<T> | null {
      if (editor) return captureVisualInsertion(editor, docKey, insert, position, view.state.selection);
      const selection = position === undefined ? view.state.selection : TextSelection.near(view.state.doc.resolve(position));
      let bookmark = selection.getBookmark(), from = selection.from, to = selection.to, rawPosition = position;
      let lease: InsertionLease<T> | null = null;
      lease = captureDocumentInsertion(docKey, {
        current: () => !view.isDestroyed && view.editable && (adapter.ownerCurrent?.() ?? true),
        insert: value => insert(value, bookmark.resolve(view.state.doc), rawPosition),
        track: cancel => {
          const target = { cancel, map(tr: Transaction) {
            if (!tr.docChanged || !lease?.current()) return;
            if (tr.getMeta('noteboard-document-replacement')) { cancel(); return; }
            const start = tr.mapping.mapResult(from, 1), end = tr.mapping.mapResult(to, -1);
            if (rawPosition !== undefined) { const mapped = tr.mapping.mapResult(rawPosition, 1); if (mapped.deletedAcross) { cancel(); return; } rawPosition = mapped.pos; }
            else if (start.deletedAcross || end.deletedAcross || (from < to && start.deleted && end.deleted)) { cancel(); return; }
            bookmark = bookmark.map(tr.mapping); const mapped = bookmark.resolve(tr.doc); from = mapped.from; to = mapped.to;
          } }; targets.add(target); return () => targets.delete(target);
        },
      });
      return lease;
    }
    const imageFiles = (view: EditorView, files: File[], position?: number) => {
      if (editor) return handlePastedImageFiles(editor, files, docKey, position);
      return handleImageFilesUsingLease(capture<InsertedImage | InsertedImage[]>(view, (value, selection, target) => insertViewImages(view, Array.isArray(value) ? value : [value], selection, target), position), files);
    };
    let plainUntil = 0, pending: InsertionLease<ImportedSlice> | null = null;
    let dropIndicator: ReturnType<typeof createImageDropIndicator> | undefined;
    let pastePointer: ReturnType<typeof trackImagePastePointer> | undefined;
    const clearDrop = () => dropIndicator?.clear();
    const mainEditorCurrent = (view: EditorView) => {
      const state = useWindowStore.getState();
      return Boolean(editor && !editor.isDestroyed && getMdTipTapEditor(docKey) === editor && view.editable && !view.dom.closest('[inert]')
        && state.activeKey === docKey && !state.isWindowClosing && !state.isTransferring(docKey) && !state.pendingCloseKeys.includes(docKey));
    };
    const removePending = () => { if (attachedView && !attachedView.isDestroyed) attachedView.dispatch(attachedView.state.tr.setMeta(pendingKey, null).setMeta('addToHistory', false)); };
    const cancel = () => { if (pending) { pending.dispose(); pending = null; removePending(); } };
    async function process(view: EditorView, raw: string, kind: Exclude<ClipboardChoice, 'images'>, lease: InsertionLease<ImportedSlice>, started: number, responseMs: number, textOptions: ExternalTextOptions & { plainText?: string }) {
      try {
        const parseStart = performance.now(), normalized = await workerNormalize(raw, kind, lease.signal, stripAnnotations, textOptions), normalizationMs = performance.now() - parseStart;
        const materializeStart = performance.now(), nodes = await materializeClipboard(normalized.content, view.state.schema, lease.signal), materializationMs = performance.now() - materializeStart;
        if (!lease.current()) return;
        const value = imported(nodes, normalized.diagnostics, normalized.openStart, normalized.openEnd, normalized.tableScope), commitStart = performance.now();
        const committed = lease.commit(value), commitMs = performance.now() - commitStart;
        if (committed) {
          lastTiming = { characters: raw.length, responseMs, normalizationMs, materializationMs, commitMs, completionMs: performance.now() - started, asynchronous: true };
          if (normalized.diagnostics.length) showToast(normalized.diagnostics.join('；'), 'info', 6000);
        }
      } catch (error) { if (lease.current() && !(error instanceof DOMException && error.name === 'AbortError')) showToast(error instanceof Error ? error.message : String(error), 'error'); }
      finally { lease.dispose(); if (pending === lease) { pending = null; removePending(); } }
    }
    return new Plugin<DecorationSet>({
      key: pendingKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, value) {
          for (const target of targets) target.map(tr);
          const target = tr.getMeta(pendingKey);
          if (target === null) return DecorationSet.empty;
          if (typeof target === 'number') return DecorationSet.create(tr.doc, [Decoration.widget(target, () => {
            const badge = document.createElement('span'); badge.textContent = '正在粘贴… 按 Esc 取消'; badge.contentEditable = 'false'; badge.setAttribute('role', 'status');
            badge.style.cssText = 'display:inline-block;padding:4px 10px;margin:2px;border-radius:6px;color:var(--text-secondary);background:var(--bg-secondary);font-size:12px;'; return badge;
          }, { side: -1 })]);
          return value.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations: state => pendingKey.getState(state),
        transformPasted: stripAnnotations ? slice => withoutNestedAnnotations(slice) : undefined,
        handlePaste: stripAnnotations ? (view, _event, slice) => {
          if (!insertTableSlice(view, slice)) dispatchDiscreteEdit(view, view.state.tr.replaceSelection(slice));
          return true;
        } : undefined,
        handleKeyDown: (_view, event) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') plainUntil = Date.now() + 1000; if (event.key === 'Escape' && (pending || targets.size)) { cancel(); for (const target of targets) target.cancel(); return true; } return false; },
        handleDOMEvents: {
          copy: (view, event) => writeDocumentClipboard(view, event, false),
          cut: (view, event) => writeDocumentClipboard(view, event, true),
          paste(view, event) {
            const data = event.clipboardData; if (!data || !view.editable || adapter.ownerCurrent?.() === false) return false;
            if (event.target instanceof Element && event.target.closest('.ProseMirror') !== view.dom) return false;
            const codeContext = Boolean(view.state.selection.$from.parent.type.spec.code || (view.state.storedMarks ?? view.state.selection.$from.marks()).some(mark => mark.type.name === 'code'));
            const started = performance.now(), requestedPlain = plainRequests.has(event) || Date.now() < plainUntil, plain = codeContext || requestedPlain; plainUntil = 0;
            const types = Array.from(data.types).filter(type => ![DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME, 'text/html', ...MARKDOWN_MIMES].includes(type) || data.getData(type).trim().length > 0);
            // A hovered image slot owns image payloads even when the text caret
            // remains in code. An explicit plain-text request still wins.
            const files = requestedPlain ? [] : clipboardFiles(data);
            const hoveredSlot = editor && mainEditorCurrent(view) ? pastePointer?.slot() : undefined;
            let choice = hoveredSlot && files.length && !types.includes(DOCUMENT_SLICE_MIME) && !types.includes(TABLE_SELECTION_MIME) ? 'images' : chooseClipboardFormat(types, requestedPlain || (codeContext && !hoveredSlot));
            if (choice === 'html' && files.length && needsClipboardImageFallback(data.getData('text/html'))) choice = 'images';
            if (choice === 'table' && !stripAnnotations && data.getData(TABLE_SELECTION_MIME).length <= CLIPBOARD_LIMITS.synchronous) return false;
            if (choice === 'images') { if (!files.length) return false; event.preventDefault(); void imageFiles(view, files, hoveredSlot?.position); return true; }
            const markdownType = MARKDOWN_MIMES.find(type => types.includes(type));
            const raw = data.getData(choice === 'table' ? TABLE_SELECTION_MIME : choice === 'document' ? DOCUMENT_SLICE_MIME : choice === 'html' ? 'text/html' : choice === 'markdown' ? markdownType! : 'text/plain');
            if (!raw) return false;
            try {
              if (raw.length > CLIPBOARD_LIMITS.characters) throw new ClipboardImportError('剪贴板内容过大，请分段粘贴（每次最多 1600 万字符）');
              const textOptions = { inferTable: !plain, tableContext: isInTable(view.state), inferMarkdown: !plain, stripAnnotations, plainText: types.includes('text/plain') ? data.getData('text/plain') : undefined };
              const textResult = choice === 'text' && !plain && raw.length <= CLIPBOARD_LIMITS.synchronous ? normalizeExternalText(raw, textOptions) : undefined;
              // Ordinary prose retains ProseMirror's native selection/mark behavior.
              if (textResult && !stripAnnotations && textResult.content.every(node => node.type === 'paragraph' && (node.content ?? []).every(child => child.type === 'text' && !child.marks?.length))) return false;
              event.preventDefault(); cancel(); lastTiming = null;
              if (choice === 'text' && plain && raw.length <= CLIPBOARD_LIMITS.synchronous) { insertClipboardPlainText(view, raw); return true; }
              if (raw.length > CLIPBOARD_LIMITS.synchronous) {
                const lease = capture<ImportedSlice>(view, (value, selection, imagePosition) => {
                  if (imageOnlySlice(value.slice) && imageSlotPosition(view.state, imagePosition ?? selection.from) !== undefined) return insertImportedSlice(view, value, selection, imagePosition);
                  if (choice === 'html' || choice === 'markdown' || choice === 'table' || (choice === 'text' && !plain)) {
                    view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
                    if (insertTableSlice(view, value.slice, value.tableScope, value.bodies)) return true;
                  }
                  if (codeContext) {
                    view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
                    return insertClipboardPlainText(view, textOptions.plainText ?? raw);
                  }
                  return insertImportedSlice(view, value, selection);
                }, hoveredSlot?.position);
                if (!lease) return true; pending = lease;
                view.dispatch(view.state.tr.setMeta(pendingKey, view.state.selection.from).setMeta('addToHistory', false));
                void process(view, raw, choice, lease, started, performance.now() - started, textOptions); return true;
              }
              const parseStart = performance.now();
              const own = choice === 'document' || choice === 'table' ? parseStructuredClipboard(raw, choice === 'table', stripAnnotations) : null;
              const normalized = own ?? textResult ?? (choice === 'text' || choice === 'markdown'
                ? normalizeExternalText(raw, textOptions, choice === 'markdown')
                : normalizeExternalHtml(new DOMParser().parseFromString(clipboardHtmlSource(raw), 'text/html'), raw, textOptions.plainText, textOptions));
              const normalizationMs = performance.now() - parseStart, materializeStart = performance.now();
              const nodes = synchronousNodes(normalized.content, view.state.schema), materializationMs = performance.now() - materializeStart;
              const value = imported(nodes, normalized.diagnostics, own?.openStart, own?.openEnd, own?.tableScope), commitStart = performance.now();
              // Table semantics remain owned by the existing table import implementation.
              if (codeContext && hoveredSlot && !imageOnlySlice(value.slice)) insertClipboardPlainText(view, data.getData('text/plain') || raw);
              else if ((choice === 'table' || !own) && insertTableSlice(view, value.slice, value.tableScope, value.bodies)) { /* Already committed atomically. */ }
              else insertImportedSlice(view, value, view.state.selection, hoveredSlot?.position);
              const commitMs = performance.now() - commitStart;
              lastTiming = { characters: raw.length, responseMs: performance.now() - started, normalizationMs, materializationMs, commitMs, completionMs: performance.now() - started, asynchronous: false };
              if (value.diagnostics.length) showToast(value.diagnostics.join('；'), 'info', 6000);
            } catch (error) { event.preventDefault(); showToast(error instanceof Error ? error.message : String(error), 'error'); }
            return true;
          },
          dragover(view, event) {
            if (!view.editable || !Array.from(event.dataTransfer?.items ?? []).some(item => item.type.startsWith('image/'))) return false;
            clearDrop(); const target = imageDropTargetAtPoint(view, { x: event.clientX, y: event.clientY }); if (!target) return false;
            dropIndicator?.show(target);
            event.preventDefault(); return true;
          },
          dragleave: () => { clearDrop(); return false; },
          drop(view, event) {
            const files = event.dataTransfer && clipboardFiles(event.dataTransfer); clearDrop(); if (!view.editable || !files?.length) return false;
            if (isNativeFileDropDuplicate(files)) { event.preventDefault(); return true; }
            const target = imageDropTargetAtPoint(view, { x: event.clientX, y: event.clientY }); if (!target) return false;
            event.preventDefault(); void imageFiles(view, files, target.position); return true;
          },
        },
      },
      view: view => {
        attachedView = view; dropIndicator = createImageDropIndicator(view);
        if (editor) pastePointer = trackImagePastePointer(view);
        // Empty image slots/buttons may own focus, or leave it on body after a
        // picker closes. Such paste events never reach ProseMirror's handlers.
        const pasteIntoHoveredSlot = (event: ClipboardEvent) => {
          if (event.defaultPrevented || !mainEditorCurrent(view) || adapter.ownerCurrent?.() === false || plainRequests.has(event) || Date.now() < plainUntil) return;
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('input, textarea, [role="textbox"]:not(.ProseMirror), .cm-editor')) return;
          const originEditor = target?.closest('.ProseMirror');
          if (originEditor && originEditor !== view.dom) return;
          // Editable content retains the existing parser and paste precedence.
          if (originEditor === view.dom && !target?.closest('button, [contenteditable="false"]')) return;
          if (!originEditor && target?.closest('[contenteditable="true"]')) return;
          const data = event.clipboardData, slot = pastePointer?.slot();
          if (!data || !slot || data.getData(TABLE_SELECTION_MIME)) return;
          try {
            const images = smallClipboardImages(view, data);
            if (images) {
              event.preventDefault(); event.stopPropagation();
              insertImportedSlice(view, images, view.state.selection, slot.position); return;
            }
          } catch { return; }
          if (data.getData(DOCUMENT_SLICE_MIME)) return;
          const files = clipboardFiles(data); if (!files.length) return;
          event.preventDefault(); event.stopPropagation(); view.focus();
          void imageFiles(view, files, slot.position);
        };
        if (editor) view.dom.ownerDocument.addEventListener('paste', pasteIntoHoveredSlot, true);
        const unregisterDrop = editor ? registerNativeFileDropTarget({
          clear: clearDrop,
          hover(_paths, point) {
            if (!mainEditorCurrent(view)) return false;
            const target = imageDropTargetAtPoint(view, point); if (!target) return false;
            dropIndicator?.show(target); return true;
          },
          drop(paths, point) {
            if (!mainEditorCurrent(view)) return false;
            const target = imageDropTargetAtPoint(view, point); if (!target) return false;
            const lease = captureVisualImageInsertion(editor, docKey, target.position); if (!lease) return false;
            void handleImagePathsUsingLease(lease, paths); return true;
          },
        }) : undefined;
        return { destroy: () => {
          view.dom.ownerDocument.removeEventListener('paste', pasteIntoHoveredSlot, true);
          unregisterDrop?.(); pastePointer?.destroy(); pending?.dispose(); for (const target of targets) target.cancel(); targets.clear(); attachedView = null; clearDrop();
        } };
      },
    });
}

export const ClipboardImport = Extension.create<{ docKey: string }>({
  name: 'clipboardImport', priority: 1100,
  addOptions() { return { docKey: '' }; },
  addProseMirrorPlugins() { return [createClipboardImportPlugin({ editor: this.editor, docKey: this.options.docKey })]; },
});
