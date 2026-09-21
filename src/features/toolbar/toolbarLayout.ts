export interface ToolbarItemSize {
  width: number;
  compactSaving?: number;
  priority: number;
  separator?: boolean;
}

/** Lower priority numbers leave the toolbar first. Keep order and whole buttons. */
export function fitToolbar(items: ToolbarItemSize[], available: number, gap = 2) {
  const removed = new Set<number>();
  let compact = false;
  const visibleItems = () => {
    const visible: number[] = [];
    let separator: number | undefined;
    items.forEach((item, index) => {
      if (item.separator) {
        if (visible.length) separator ??= index;
      } else if (!removed.has(index)) {
        if (separator !== undefined) visible.push(separator);
        separator = undefined;
        visible.push(index);
      }
    });
    return visible;
  };
  const fits = () => {
    const visible = visibleItems();
    const width = visible.reduce((sum, index) => sum + items[index].width
      - (compact ? items[index].compactSaving ?? 0 : 0), 0)
      + Math.max(0, visible.length - 1) * gap;
    return width <= Math.max(0, available);
  };
  if (!fits()) compact = true;
  const order = items.map((item, index) => ({ ...item, index }))
    .filter((item) => !item.separator)
    .sort((a, b) => a.priority - b.priority || b.index - a.index);
  for (const item of order) {
    if (fits()) break;
    removed.add(item.index);
  }
  return { compact, visible: visibleItems() };
}
