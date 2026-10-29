import type { Editor } from '@tiptap/core';
import { createRichDocumentCounter, type DocumentStatistics } from './documentStatistics';
import { createStatisticsScheduler } from './statisticsScheduler';

interface RuntimeStatistics { owner: object; value: DocumentStatistics | null }
const runtimes = new Map<string, RuntimeStatistics>();
const listeners = new Map<string, Set<() => void>>();
function notify(key: string) { listeners.get(key)?.forEach(listener => listener()); }
export function subscribeRichDocumentStatistics(key: string, listener: () => void): () => void {
  const subscriptions = listeners.get(key) ?? new Set(); listeners.set(key, subscriptions); subscriptions.add(listener);
  return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(key); };
}
export function getRichDocumentStatistics(key: string): DocumentStatistics | null { return runtimes.get(key)?.value ?? null; }

/** Editor-owned registration; call after document initialization and dispose with that editor instance. No serialization/flush. */
export function bindRichDocumentStatistics(docKey: string, editor: Editor): () => void {
  const owner = {}, count = createRichDocumentCounter();
  let disposed = false, lastDocument = editor.state.doc;
  runtimes.set(docKey, { owner, value: null }); notify(docKey);
  const scheduler = createStatisticsScheduler(() => {
    if (editor.isDestroyed || runtimes.get(docKey)?.owner !== owner) return;
    const value = count(editor.state.doc), previous = runtimes.get(docKey)?.value;
    if (previous?.characters === value.characters && previous.words === value.words) return;
    runtimes.set(docKey, { owner, value }); notify(docKey);
  });
  const update = () => {
    if (editor.state.doc === lastDocument) return;
    lastDocument = editor.state.doc; scheduler.schedule();
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    scheduler.dispose(); editor.off('transaction', update); editor.off('destroy', dispose);
    if (runtimes.get(docKey)?.owner === owner) { runtimes.delete(docKey); notify(docKey); }
  };
  // Transaction includes programmatic replacements with emitUpdate:false; identity makes caret-only checks O(1).
  editor.on('transaction', update); editor.on('destroy', dispose); scheduler.schedule();
  return dispose;
}
