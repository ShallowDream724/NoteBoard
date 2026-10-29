import { useEffect, useReducer } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { on, off } from '../../core/emitter';

/** Subscribe a formatting surface, not the editor document or lazy-preview tree. */
export function useFormattingUpdates(editor: Editor | null, enabled = true) {
  const [, update] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!editor || !enabled) return;
    let frame = 0;
    const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
      if (!tr.docChanged && !tr.selectionSet && !tr.storedMarksSet) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    editor.on('transaction', transaction);
    return () => { cancelAnimationFrame(frame); editor.off('transaction', transaction); };
  }, [editor, enabled]);
}

export function useSourceFormattingUpdates(docKey: string, enabled: boolean) {
  const [, update] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    // The source view is registered by a sibling's mount effect. Refresh once
    // after effects settle so a source-first toolbar can discover that view.
    let frame = requestAnimationFrame(() => { frame = 0; update(); });
    const change = ({ key }: { key: string }) => {
      if (key === docKey && !frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    on('md-source-selection-changed', change);
    return () => { cancelAnimationFrame(frame); off('md-source-selection-changed', change); };
  }, [docKey, enabled]);
}
