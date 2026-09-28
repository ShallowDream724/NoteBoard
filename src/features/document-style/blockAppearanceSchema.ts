import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { documentColor } from './colors';

/** Explicit text-container policy. Media, code and table fills have their own controls. */
export const BLOCK_COLOR_TYPES = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'] as const;
export const BLOCK_COLOR_FIELDS = ['blockTextColor', 'blockBackground'] as const;
export const supportsBlockColors = (type: string): boolean => (BLOCK_COLOR_TYPES as readonly string[]).includes(type) || type === 'mathBlock';

export const BlockAppearance = Extension.create({
  name: 'blockAppearance',
  priority: 110,
  addGlobalAttributes() {
    return [{ types: [...BLOCK_COLOR_TYPES], attributes: Object.fromEntries(BLOCK_COLOR_FIELDS.map(field => [field, {
      default: null, keepOnSplit: false,
      parseHTML: (element: HTMLElement) => documentColor(element.getAttribute(field === 'blockTextColor' ? 'data-block-text-color' : 'data-block-background')),
      renderHTML: (attrs: Record<string, unknown>) => {
        const color = documentColor(attrs[field]); if (!color) return {};
        return field === 'blockTextColor'
          ? { 'data-block-text-color': color, style: `color:${color};print-color-adjust:exact` }
          : { 'data-block-background': color, style: `background-color:${color};--nb-block-background:${color};print-color-adjust:exact` };
      },
    }])) }];
  },
  addKeyboardShortcuts() { return { Backspace: () => {
    const { state } = this.editor, { selection, doc } = state;
    if (!selection.empty || selection.$from.parent.type.name !== 'paragraph' || selection.$from.parent.content.size || selection.$from.depth !== 1) return false;
    const node = selection.$from.parent, pos = selection.$from.before();
    // A document must retain one paragraph. Removing its last styled empty row
    // clears the row's appearance, without touching text marks or adjacent rows.
    if (!BLOCK_COLOR_FIELDS.some(field => node.attrs[field])) return false;
    let paragraphs = 0, otherContent = false;
    doc.forEach(child => { if (child.type.name === 'paragraph') paragraphs++; else if (child.type.name !== 'documentPresentation') otherContent = true; });
    if (paragraphs !== 1 || otherContent) return false;
    this.editor.view.dispatch(closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, blockTextColor: null, blockBackground: null }));
    this.editor.view.dispatch(closeHistory(this.editor.state.tr));
    return true;
  } }; },
});
