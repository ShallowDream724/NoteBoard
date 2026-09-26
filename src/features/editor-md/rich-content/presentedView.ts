import { getExtensionField, type Node as NodeExtension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

/** Custom views bypass schema.toDOM. Apply shared block presentation at their
 * boundary, without a document scan or a second decoration plugin. */
export function withRichPresentation<T extends NodeExtension>(extension: T): T {
  // configure clones the definition without adding an inheritance level. In
  // TipTap 3, extend also copies hooks: a copied hook calling this.parent can
  // execute itself again (including keyed plugin registration).
  const presented = extension.configure();
  presented.config.addNodeView = function () {
    const create = getExtensionField<NodeExtension['config']['addNodeView']>(extension, 'addNodeView', this)?.();
    if (!create) throw new Error(`Missing node view: ${this.name}`);
    return props => {
      const view = create(props);
      const originalTabIndex = view.dom instanceof HTMLElement ? view.dom.getAttribute('tabindex') : null;
      const paint = (node: Node) => {
        if (!(view.dom instanceof HTMLElement)) return;
        view.dom.toggleAttribute('data-nb-conceal', Boolean(node.attrs.concealed));
        if (node.attrs.concealed) view.dom.tabIndex = 0;
        else if (originalTabIndex === null) view.dom.removeAttribute('tabindex');
        else view.dom.setAttribute('tabindex', originalTabIndex);
      };
      const update = view.update?.bind(view);
      view.update = (node, decorations, innerDecorations) => {
        const updated = update?.(node, decorations, innerDecorations) ?? false;
        if (updated) paint(node); return updated;
      };
      paint(props.node); return view;
    };
  };
  return presented as T;
}
