import { Fragment, type Node } from '@tiptap/pm/model';

export const RESTORABLE_TEXT_CONTAINERS = new Set(['githubAlert', 'disclosure']);
type Changed = (before: Node, after: Node) => void;

/** Carry user-authored appearance and concealment through a removed text shell.
 * Media placement is never part of this patch. Preset Callout frame colors/icons
 * disappear with the frame; explicit inherited foreground remains readable. */
export function inheritTextContainer(node: Node, children: Node[], changed?: Changed): Node[] {
  const color = node.type.name === 'githubAlert' ? node.attrs.textColor : node.attrs.blockTextColor;
  const background = node.attrs.blockBackground;
  const visit = (child: Node, inheritedColor: unknown, inheritedBackground: unknown, concealed: boolean): Node => {
    const attrs = { ...child.attrs }; let patched = false;
    const foreground = child.type.name === 'githubAlert' ? 'textColor' : 'blockTextColor';
    for (const [field, value] of [[foreground, inheritedColor], ['blockBackground', inheritedBackground]] as const) {
      if (value != null && Object.hasOwn(attrs, field) && attrs[field] == null) { attrs[field] = value; patched = true; }
    }
    if (concealed && Object.hasOwn(attrs, 'concealed') && !attrs.concealed) { attrs.concealed = true; patched = true; }
    const nextColor = Object.hasOwn(attrs, foreground) ? null : inheritedColor;
    const nextBackground = Object.hasOwn(attrs, 'blockBackground') ? null : inheritedBackground;
    const nextConcealed = concealed && !Object.hasOwn(attrs, 'concealed');
    let content = child.content;
    if (child.childCount && (nextColor != null || nextBackground != null || nextConcealed)) {
      const items: Node[] = []; let different = false;
      child.forEach(item => { const next = visit(item, nextColor, nextBackground, nextConcealed); items.push(next); different ||= next !== item; });
      if (different) content = Fragment.fromArray(items);
    }
    const next = patched ? child.type.create(attrs, content, child.marks) : content === child.content ? child : child.copy(content);
    if (next !== child) changed?.(child, next);
    return next;
  };
  return color != null || background != null || node.attrs.concealed
    ? children.map(child => visit(child, color, background, !!node.attrs.concealed)) : children;
}

/** Preserve titles and annotations once, without overwriting a child's anchor. */
export function carryContainerAnnotation(node: Node, body: Node[], changed?: Changed): Node[] {
  if (!node.attrs.annotationId) return body;
  const children = [...body], paragraph = node.type.schema.nodes.paragraph;
  if (!children[0] || children[0].attrs.annotationId || !Object.hasOwn(children[0].attrs, 'annotationId')) children.unshift(paragraph.create());
  const first = children[0], next = first.type.create({ ...first.attrs, annotationId: node.attrs.annotationId }, first.content, first.marks);
  children[0] = next; changed?.(first, next);
  return children;
}
export function unwrapTextContainer(node: Node, body: Node[], changed?: Changed): Node[] {
  const children = [...body], paragraph = node.type.schema.nodes.paragraph;
  const title = typeof node.attrs.title === 'string' ? node.attrs.title.trim() : '';
  if (title) children.unshift(paragraph.create(null, node.type.schema.text(title)));
  return inheritTextContainer(node, carryContainerAnnotation(node, children, changed), changed);
}
