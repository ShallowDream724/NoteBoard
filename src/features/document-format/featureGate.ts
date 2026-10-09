import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { editorDocumentDirectory, editorDocumentFormat, editorDocumentKey } from '../editor-md/editorDocumentCodec';
import { sameDocument } from './documentComparison';
import { getMdTipTapEditor, subscribeMdTipTapEditors } from '../editor-md/editorInstances';
import { formatSupportsCapability, type DocumentCapabilityId } from './capabilities';
import { showToast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function editorSupportsCapability(editor: Editor, capability: DocumentCapabilityId): boolean {
  return formatSupportsCapability(editorDocumentFormat(editor), capability);
}
export function useNativeFeatureVisibility(): boolean {
  return !useSettingsStore(state => state.settings.editor.pureMarkdown ?? false);
}
const pending = new WeakMap<Editor, Promise<Editor | null>>();
function waitForNativeEditor(key: string): Promise<Editor | null> {
  const current = getMdTipTapEditor(key);
  if (current && !current.isDestroyed && editorDocumentFormat(current) === 'noteboard') return Promise.resolve(current);
  return new Promise(resolve => {
    const finish = (editor: Editor | null) => { unsubscribe(); clearTimeout(timeout); resolve(editor); };
    const unsubscribe = subscribeMdTipTapEditors((registeredKey, editor) => {
      if (registeredKey === key && !editor.isDestroyed && editorDocumentFormat(editor) === 'noteboard') finish(editor);
    });
    const timeout = setTimeout(() => finish(null), 15_000);
  });
}
/** Acquire a capable editor before imports or any other asynchronous mutation. */
export function ensureDocumentCapability(editor: Editor, capability: DocumentCapabilityId): Promise<Editor | null> {
  if (editor.isDestroyed) return Promise.resolve(null);
  if (editorSupportsCapability(editor, capability)) return Promise.resolve(editor);
  const key = editorDocumentKey(editor);
  if (!key || useSettingsStore.getState().settings.editor.pureMarkdown) return Promise.resolve(null);
  const existing = pending.get(editor); if (existing) return existing;
  const selection = editor.state.selection.toJSON(), before = editor.state.doc;
  const request = (async () => {
    const { requestNativeConversion } = await import('./NativeConversionDialog');
    const options = await requestNativeConversion(!key.startsWith('untitled:'));
    if (!options || editor.isDestroyed) return null;
    if (!editor.state.doc.eq(before)) { showToast('内容已变化，请重新应用此操作', 'warning'); return null; }
    const { convertMarkdownToNative } = await import('./convertDocument');
    const newKey = await convertMarkdownToNative(key, options);
    if (!newKey) return null;
    const next = await waitForNativeEditor(newKey);
    if (!next) { showToast('文档已转换，请等待编辑器加载后重试', 'warning'); return null; }
    if (!sameDocument(before, next.state.doc, editorDocumentDirectory(editor))) { showToast('文档已转换，内容已变化，请重新选择后应用此操作', 'warning'); return null; }
    try { next.view.dispatch(next.state.tr.setSelection(Selection.fromJSON(next.state.doc, selection))); }
    catch { return null; }
    return next;
  })().catch(error => { showToast(`转换失败：${error instanceof Error ? error.message : String(error)}`, 'error'); return null; })
    .finally(() => pending.delete(editor));
  pending.set(editor, request);
  return request;
}
/** Synchronous native command; MD requests conversion and replays only on success. */
export function runWithDocumentCapability(editor: Editor, capability: DocumentCapabilityId, action: (editor: Editor) => boolean | void): boolean {
  if (editor.isDestroyed) return false;
  if (editorSupportsCapability(editor, capability)) return action(editor) !== false;
  // Repeated keydown/drag events while the dialog is open must not queue edits.
  if (!pending.has(editor)) void ensureDocumentCapability(editor, capability).then(next => { if (next && !next.isDestroyed) action(next); });
  return false;
}
