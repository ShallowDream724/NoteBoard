export const COLLECTION_WIDTHS = ['100%', '75%', '50%', '25%'] as const;
export const isCollectionWidth = (value: unknown): value is string => typeof value === 'string' && /^(?:100|[1-9]\d?)%$/.test(value);
export const isCollectionAlign = (value: unknown): value is 'left' | 'center' | 'right' => value === 'left' || value === 'center' || value === 'right';

/** Shared by the editor, clipboard HTML and print/HTML serializers. */
export function collectionPresentation(attrs: { width?: unknown; align?: unknown; layout?: unknown }) {
  const width = isCollectionWidth(attrs.width) ? attrs.width : '100%';
  const align = attrs.layout === 'carousel' ? 'center' : isCollectionAlign(attrs.align) ? attrs.align : 'center';
  return { width, align, style: `width:${width};margin-left:${align === 'left' ? '0' : 'auto'};margin-right:${align === 'right' ? '0' : 'auto'}` };
}
