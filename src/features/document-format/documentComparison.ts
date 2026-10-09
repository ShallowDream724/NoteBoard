import type { Node } from '@tiptap/pm/model';
import { resolveRelativeDocPath } from '../../core/documentPath';

function comparableAttrs(type: string, attrs: Record<string, unknown>, directory: string): string {
  const field = type === 'image' ? 'src' : type === 'link' ? 'href' : null;
  const value = field && attrs[field];
  if (field && typeof value === 'string' && value && !/^(?:[a-z][a-z0-9+.-]*:|[\\/#])/i.test(value) && directory) {
    return JSON.stringify({ ...attrs, [field]: resolveRelativeDocPath(directory, value).replace(/\\/g, '/') });
  }
  return JSON.stringify(attrs);
}

/** Compare schemas by semantic structure, without allocating full JSON trees. */
export function sameDocument(left: Node, right: Node, directory = ''): boolean {
  if (left === right) return true;
  if (left.type.name !== right.type.name || left.text !== right.text || left.childCount !== right.childCount
    || comparableAttrs(left.type.name, left.attrs, directory) !== comparableAttrs(right.type.name, right.attrs, directory) || left.marks.length !== right.marks.length) return false;
  for (let index = 0; index < left.marks.length; index++) {
    const a = left.marks[index], b = right.marks[index];
    if (a.type.name !== b.type.name || comparableAttrs(a.type.name, a.attrs, directory) !== comparableAttrs(b.type.name, b.attrs, directory)) return false;
  }
  for (let index = 0; index < left.childCount; index++) if (!sameDocument(left.child(index), right.child(index), directory)) return false;
  return true;
}
