import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import './editorMenuScope.css';

export const EDITOR_MENU_ACTIVITY = 'nb-editor-menu-activity';
const OPEN_CLASS = 'nb-toolbar-menu-open';

interface MenuScope {
  container: HTMLElement;
  retain: (id: string) => () => void;
}
const Context = createContext<MenuScope | null>(null);

export function isEditorToolbarMenuOpen(element: HTMLElement) {
  return element.classList.contains(OPEN_CLASS);
}

/** One document's top menus share a body-level host and an activity lease.
 * Selection stays in the editor while its auxiliary toolbar is suspended. */
export function EditorMenuScope({ editor, children }: { editor: Editor | null; children: ReactNode }) {
  const [container] = useState(() => {
    const element = document.createElement('div');
    element.className = 'nb-editor-menu-overlay';
    return element;
  });
  const scope = useMemo<MenuScope>(() => {
    const leases = new Set<string>();
    const notify = () => {
      if (!editor || editor.isDestroyed) return;
      const element = editor.view.dom, open = leases.size > 0;
      if (element.classList.contains(OPEN_CLASS) === open) return;
      element.classList.toggle(OPEN_CLASS, open);
      element.dispatchEvent(new CustomEvent(EDITOR_MENU_ACTIVITY));
    };
    return { container, retain: id => {
      leases.add(id); notify();
      return () => { leases.delete(id); notify(); };
    } };
  }, [container, editor]);
  useLayoutEffect(() => {
    document.body.append(container);
    return () => { container.remove(); };
  }, [container]);
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}

export function useEditorMenuPortalContainer() {
  return useContext(Context)?.container;
}

export function useEditorMenuActivity(id: string, open: boolean) {
  const scope = useContext(Context);
  useLayoutEffect(() => open ? scope?.retain(id) : undefined, [scope, id, open]);
}
