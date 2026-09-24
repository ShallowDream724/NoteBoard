import { TableCell, TableHeader } from '@tiptap/extension-table';
import { documentColor } from '../document-style/colors';

/** Literal colors only: document metadata never becomes arbitrary CSS. */
export const tableFill = documentColor;
export const TABLE_FILLS = [
  { color: '#fef3c7', label: '浅黄' }, { color: '#ffedd5', label: '浅橙' },
  { color: '#fee2e2', label: '浅红' }, { color: '#fce7f3', label: '浅粉' },
  { color: '#ede9fe', label: '浅紫' }, { color: '#dbeafe', label: '浅蓝' },
  { color: '#dcfce7', label: '浅绿' }, { color: '#e2e8f0', label: '浅灰' },
] as const;

function backgroundAttribute() {
  return { default: null,
    parseHTML: (element: HTMLElement) => tableFill(element.getAttribute('data-cell-background')),
    renderHTML: (attrs: Record<string, unknown>) => {
      const color = tableFill(attrs.background);
      return color ? { 'data-cell-background': color, style: `--nb-cell-background:${color}` } : {};
    },
  };
}
export const PresentedTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), background: backgroundAttribute() }; },
});
export const PresentedTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), background: backgroundAttribute() }; },
});
