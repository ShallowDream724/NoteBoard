import { create } from 'zustand';
import { useDocumentStore } from './documentStore';

export interface SaveActivity { pending: number; error: string | null }
export const useSaveActivityStore = create<{ activities: Map<string, SaveActivity> }>(() => ({ activities: new Map() }));
const requests = new Map<string, Set<symbol>>();

function publish(key: string, pending: number, error: string | null) {
  useSaveActivityStore.setState(state => {
    const activities = new Map(state.activities);
    if (pending || error) activities.set(key, { pending, error }); else activities.delete(key);
    return { activities };
  });
}

/** Activity is separate from dirty: automatic save may be waiting for its
 * debounce, and a successful write may leave newer input unsaved. */
export async function trackDocumentSave<T>(key: string, task: () => Promise<T>): Promise<T> {
  const token = Symbol(), active = requests.get(key) ?? new Set<symbol>();
  active.add(token); requests.set(key, active);
  publish(key, active.size, null);
  try { return await task(); }
  catch (error) {
    if (requests.get(key) === active) recordSaveError(key, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    if (requests.get(key) === active) {
      active.delete(token);
      if (!active.size) requests.delete(key);
      publish(key, active.size, useSaveActivityStore.getState().activities.get(key)?.error ?? null);
    }
  }
}

export function recordSaveError(key: string, error: string): void {
  if (!useDocumentStore.getState().hasDocument(key)) return;
  publish(key, requests.get(key)?.size ?? 0, error);
}

export function clearSaveError(key: string): void {
  if (useSaveActivityStore.getState().activities.get(key)?.error) publish(key, requests.get(key)?.size ?? 0, null);
}

// Closed documents do not retain status or let an old completion affect a
// newly opened document with the same path.
useDocumentStore.subscribe((state, previous) => {
  if (state.documents === previous.documents) return;
  for (const key of previous.documents.keys()) if (!state.documents.has(key)) {
    requests.delete(key);
    if (useSaveActivityStore.getState().activities.has(key)) publish(key, 0, null);
  }
});
