import type { Node } from '@tiptap/pm/model';

const textContainers = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem']);
export const TEXT_STYLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'textColor', 'subscript', 'superscript', 'conceal'] as const;

/** Reset only a complete text unit's presentation. Media/cell/frame attributes
 * are not text styles, even when their schema uses similarly named fields. */
export function textStyleResetAttributes(node: Node): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (textContainers.has(node.type.name)) {
    for (const field of ['blockTextColor', 'blockBackground']) if (node.attrs[field] != null) patch[field] = null;
    if (['paragraph', 'heading'].includes(node.type.name)) {
      if (node.attrs.textAlign != null) patch.textAlign = null;
      if (node.attrs.indent) patch.indent = 0;
    }
  } else if (node.type.name === 'githubAlert') {
    for (const field of ['textColor', 'backgroundColor', 'borderColor', 'icon']) if (node.attrs[field] != null) patch[field] = null;
  }
  if (node.attrs.concealed) patch.concealed = false;
  return Object.keys(patch).length ? patch : null;
}
