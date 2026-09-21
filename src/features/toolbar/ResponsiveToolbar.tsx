import { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ToolbarDivider } from './ToolbarComponents';
import { fitToolbar } from './toolbarLayout';
import './ResponsiveToolbar.css';

interface ItemProps { collapsePriority?: number }

/** Owns layout only; formatting commands and dropdown state stay with the toolbar. */
export function ResponsiveToolbar({ children, onLayoutChange }: {
  children: ReactNode;
  onLayoutChange?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(isValidElement<ItemProps>);
  const signature = items.map((item) => item.type === ToolbarDivider ? 'divider' : item.props.collapsePriority ?? 100).join(',');
  const onChangeRef = useRef(onLayoutChange);
  onChangeRef.current = onLayoutChange;
  const [layout, setLayout] = useState<{ compact: boolean; visible: number[] } | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const slots = Array.from(element.children) as HTMLElement[];
    let frame = 0;
    let previous = '';
    const measure = () => {
      const currentlyCompact = element.dataset.compact === 'true';
      const sizes = slots.map((slot) => {
        const label = slot.querySelector<HTMLElement>('[data-toolbar-compact-label]');
        const saving = label ? label.getBoundingClientRect().width
          + (Number.parseFloat(getComputedStyle(label.parentElement!).columnGap) || 0) : 0;
        return {
          width: slot.getBoundingClientRect().width + (currentlyCompact ? saving : 0),
          compactSaving: saving,
          priority: Number(slot.dataset.priority),
          separator: slot.dataset.separator === 'true',
        };
      });
      const next = fitToolbar(sizes, element.clientWidth);
      const key = `${next.compact}:${next.visible.join(',')}`;
      if (key !== previous) {
        if (previous) onChangeRef.current?.();
        previous = key;
        setLayout(next);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Hidden slots retain their intrinsic width without contributing to layout,
    // so restoring buttons never needs probing renders or guessed breakpoints.
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    slots.forEach((slot) => {
      observer.observe(slot);
      const label = slot.querySelector('[data-toolbar-compact-label]');
      if (label) observer.observe(label);
    });
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [signature]);

  return (
    <div ref={root} className="responsive-toolbar" data-compact={layout?.compact ?? false}>
      {items.map((item, index) => {
        const hidden = layout !== null && !layout.visible.includes(index);
        return (
          <div key={item.key ?? index} className="responsive-toolbar-item"
            data-priority={item.props.collapsePriority ?? 100}
            data-separator={item.type === ToolbarDivider}
            data-hidden={hidden} aria-hidden={hidden || undefined} inert={hidden || undefined}>
            {item}
          </div>
        );
      })}
    </div>
  );
}
