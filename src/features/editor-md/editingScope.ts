import { useCallback, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

export type EditingScope =
  | { readonly kind: 'tiptap'; readonly editor: Editor; readonly inlineOnly: true;
      readonly openLink: () => void; readonly history: (direction: 'undo' | 'redo') => void }
  | { readonly kind: 'external'; readonly focus?: () => void };

// Parent identity prevents a child editor in one document owning another tab's
// commands. Weak keys and per-parent listeners retain neither document trees nor
// closed editors. Replacing/disposing a scope is constant work.
const scopes = new WeakMap<EditorView, EditingScope>();
const listeners = new WeakMap<EditorView, Set<() => void>>();
const scopeCleanup = new WeakMap<EditorView, () => void>();
export function getEditingScope(parent: EditorView | undefined): EditingScope | null {
  return parent ? scopes.get(parent) ?? null : null;
}
export function registerEditingScope(parent: EditorView, scope: EditingScope): () => void {
  scopeCleanup.get(parent)?.();
  scopes.set(parent, scope);
  listeners.get(parent)?.forEach(listener => listener());
  return () => {
    if (scopes.get(parent) !== scope) return;
    scopeCleanup.get(parent)?.();
    scopes.delete(parent);
    listeners.get(parent)?.forEach(listener => listener());
  };
}
export function registerExternalEditingScope(parent: EditorView, options: { focus?: () => void } = {}): () => void {
  const release = registerEditingScope(parent, { kind: 'external', ...options });
  // An open annotation panel may remain visible while the user returns to body
  // text. Only explicit focus on the parent editable transfers ownership back;
  // toolbar/portal focus and a caption's parent-history navigation do not.
  const onFocus = (event: FocusEvent) => { if (event.target === parent.dom) release(); };
  const cleanup = () => {
    parent.dom.removeEventListener('focus', onFocus);
    if (scopeCleanup.get(parent) === cleanup) scopeCleanup.delete(parent);
  };
  parent.dom.addEventListener('focus', onFocus);
  scopeCleanup.set(parent, cleanup);
  return release;
}
export function useEditingScope(parent: EditorView | undefined): EditingScope | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!parent) return () => {};
    let subscriptions = listeners.get(parent);
    if (!subscriptions) { subscriptions = new Set(); listeners.set(parent, subscriptions); }
    subscriptions.add(listener);
    return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(parent); };
  }, [parent]);
  const snapshot = useCallback(() => getEditingScope(parent), [parent]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Toolbar mouse/focus transfers preserve the active child selection, including
 * portal menus. New surfaces can explicitly opt in with the data attribute. */
export function isEditingScopeInteraction(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    '.responsive-toolbar,.nb-highlight-menu,[data-caption-toolbar],[data-editing-scope-interaction]',
  );
}
