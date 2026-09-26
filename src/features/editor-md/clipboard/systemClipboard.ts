import type { Editor } from '@tiptap/core';
import { useWindowStore } from '../../../stores/windowStore';
import { showToast } from '../../../stores/toastStore';
import { captureVisualInsertion } from '../imageInsertionLease';
import { importClipboardSnapshot, type ClipboardSnapshot } from './clipboardImport';
import { DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME } from './constants';
import { MARKDOWN_MIMES, needsClipboardImageFallback } from './external';

/** Read rich formats without decoding a redundant PNG when HTML is available. */
export async function readClipboardSnapshot(plain = false): Promise<ClipboardSnapshot> {
  if (plain || !navigator.clipboard.read) return { formats: { 'text/plain': await navigator.clipboard.readText() } };
  try {
    const items = await navigator.clipboard.read(), formats: Record<string, string> = {};
    for (const item of items) for (const type of item.types) {
      const canonical = type.replace(/^web /, '');
      if (['text/html', 'text/plain', ...MARKDOWN_MIMES, DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME].includes(canonical) && formats[canonical] === undefined) formats[canonical] = await (await item.getType(type)).text();
    }
    const files: File[] = [];
    if ((!formats['text/html'] || needsClipboardImageFallback(formats['text/html'])) && !MARKDOWN_MIMES.some(type => formats[type]) && !formats[DOCUMENT_SLICE_MIME] && !formats[TABLE_SELECTION_MIME]) {
      for (const item of items) for (const type of item.types) if (type.startsWith('image/')) {
        const blob = await item.getType(type); files.push(new File([blob], `clipboard-${files.length + 1}.${type.split('/')[1]}`, { type }));
      }
    }
    return { formats, files };
  } catch { return { formats: { 'text/plain': await navigator.clipboard.readText() } }; }
}
export async function pasteFromSystemClipboard(editor: Editor, plain = false): Promise<void> {
  const docKey = useWindowStore.getState().activeKey; if (!docKey) return;
  const lease = captureVisualInsertion<ClipboardSnapshot>(editor, docKey, (snapshot, selection) => {
    editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false));
    return importClipboardSnapshot(editor.view, snapshot, plain);
  });
  if (!lease) return;
  try { const snapshot = await readClipboardSnapshot(plain); lease.commit(snapshot); }
  catch (error) { if (lease.current()) showToast(`无法读取剪贴板：${error instanceof Error ? error.message : String(error)}`, 'error'); }
  finally { lease.dispose(); }
}
