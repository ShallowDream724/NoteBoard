import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import './verticalScrollArea.css';

type Props = {
  children: ReactNode;
  label: string;
  onWheel?: ComponentPropsWithoutRef<typeof ScrollArea.Viewport>['onWheel'];
};

/** Native scrolling with an overlay thumb. Scroll position never enters React state. */
export function VerticalScrollArea({ children, label, onWheel }: Props) {
  return (
    <ScrollArea.Root className="nb-vertical-scroll-area" type="auto">
      <ScrollArea.Viewport className="nb-vertical-scroll-viewport" tabIndex={0}
        role="region" aria-label={label} onWheel={onWheel}>
        {children}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="nb-vertical-scrollbar" orientation="vertical">
        <ScrollArea.Thumb className="nb-vertical-scroll-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
