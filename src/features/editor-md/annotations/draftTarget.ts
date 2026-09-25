import { NodeSelection, type Selection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** A draft owns a mapped target, never a snapshot of the entire main document. */
export interface AnnotationDraftTarget {
  bookmark: SelectionBookmark;
  from: number;
  to: number;
  node: boolean;
  invalid: boolean;
}

export function captureAnnotationTarget(selection: Selection): AnnotationDraftTarget {
  return { bookmark: selection.getBookmark(), from: selection.from, to: selection.to, node: selection instanceof NodeSelection, invalid: false };
}

export function mapAnnotationTarget(target: AnnotationDraftTarget, transaction: Transaction): AnnotationDraftTarget {
  if (!transaction.docChanged) return target;
  const from = transaction.mapping.mapResult(target.from, 1), to = transaction.mapping.map(target.to, -1);
  return { ...target, bookmark: target.bookmark.map(transaction.mapping), from: from.pos, to,
    invalid: target.invalid || from.deletedAcross || to <= from.pos };
}

export function resolveAnnotationTarget(target: AnnotationDraftTarget, doc: ProseMirrorNode): Selection | null {
  if (target.invalid) return null;
  try {
    const selection = target.bookmark.resolve(doc);
    return selection.empty || (target.node && !(selection instanceof NodeSelection)) ? null : selection;
  } catch { return null; }
}
