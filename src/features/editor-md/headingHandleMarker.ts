import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

const marker = 'data-nb-block-handle-active';

/** Mark the UI-owned folding widget, whose ViewDesc ignores DOM attribute mutations.
 * Mutating the heading itself would make ProseMirror reparse and replace it. */
export function markHeadingHandleTarget(editor: Editor, initialPos: number): () => void {
  let pos: number | null = initialPos;
  let target: HTMLElement | null = null;
  const apply = () => {
    const node = pos !== null && pos < editor.state.doc.content.size ? editor.view.nodeDOM(pos) : null;
    const first = node instanceof HTMLElement && /^H[1-6]$/.test(node.tagName) ? node.firstElementChild : null;
    const next = first instanceof HTMLElement && first.classList.contains('nb-heading-fold-toggle') ? first : null;
    if (target !== next) {
      target?.removeAttribute(marker);
      target = next;
    }
    if (target && !target.hasAttribute(marker)) target.setAttribute(marker, '');
  };
  const update = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged && pos !== null) {
      const mapped = transaction.mapping.mapResult(pos, 1);
      pos = mapped.deleted ? null : mapped.pos;
    }
    apply();
  };
  apply();
  editor.on('transaction', update);
  return () => { editor.off('transaction', update); target?.removeAttribute(marker); };
}
