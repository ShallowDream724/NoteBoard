import type { JSONContent } from '@tiptap/core';
import { getMdSourceView, getMdTipTapEditor } from './editorInstances';
import { useWindowStore } from '../../stores/windowStore';
import { readStyledSource } from '../document-style/sourceStyleTracking';

/** Read-only consumers capture the authoritative editor, without materializing
 * history or writing a store/disk snapshot. JSON serialization runs in a worker. */
export function readMarkdownSnapshot(key: string): string | JSONContent | null {
  if (useWindowStore.getState().getTab(key)?.viewMode === 'source') {
    const view = getMdSourceView(key);
    return view ? readStyledSource(view.state) : null;
  }
  const editor = getMdTipTapEditor(key);
  return editor && !editor.isDestroyed ? editor.state.doc.toJSON() : null;
}
