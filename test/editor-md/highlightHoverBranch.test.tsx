// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HoverMenuContext, useHoverMenu } from '../../src/components/useHoverMenu';
import { HighlightControl } from '../../src/features/toolbar/HighlightControl';

const move = (from: Element, to: Element) => {
  from.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
  to.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: from }));
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('retains a block menu while moving from the palette arrow to A and into its portalled palette', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  function Fixture() {
    const [parentOpen, setParentOpen] = useState(true), [open, setOpen] = useState(false);
    const parent = useHoverMenu(parentOpen, setParentOpen);
    return <><button id="outside">outside</button>{parentOpen && <div data-parent-menu="" onPointerEnter={parent.contentProps.onPointerEnter} onPointerLeave={parent.contentProps.onPointerLeave}>
      <HoverMenuContext.Provider value={parent}><HighlightControl active={false} open={open} onOpenChange={setOpen}
        onApply={() => {}} onRemove={() => {}} onReturnToEditor={() => {}}/></HoverMenuContext.Provider>
    </div>}</>;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Fixture/>));
    const outside = document.querySelector('#outside')!, arrow = document.querySelector('.nb-text-style-expand')!, main = document.querySelector('.nb-highlight-apply')!;
    await act(async () => { move(outside, arrow); vi.advanceTimersByTime(100); move(arrow, main); vi.advanceTimersByTime(450); });
    expect(document.querySelector('[data-parent-menu]')).not.toBeNull();
    expect(document.querySelector('.nb-highlight-menu')).toBeNull();
    await act(async () => { move(main, arrow); vi.advanceTimersByTime(300); });
    const palette = document.querySelector('.nb-highlight-menu')!; expect(palette).not.toBeNull();
    await act(async () => { move(arrow, palette); vi.advanceTimersByTime(500); });
    expect(document.querySelector('[data-parent-menu]')).not.toBeNull();
    expect(document.querySelector('.nb-highlight-menu')).not.toBeNull();
    await act(async () => { move(palette, main); vi.advanceTimersByTime(500); });
    expect(document.querySelector('[data-parent-menu]')).not.toBeNull();
    await act(async () => { move(main, outside); vi.advanceTimersByTime(500); });
    expect(document.querySelector('[data-parent-menu]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('retains all ancestors when entering a third-level portalled menu', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  function Branch({ level }: { level: number }) {
    const [open, setOpen] = useState(true), menu = useHoverMenu(open, setOpen);
    return open && <HoverMenuContext.Provider value={menu}>
      {createPortal(<div data-level={level} onPointerEnter={menu.contentProps.onPointerEnter} onPointerLeave={menu.contentProps.onPointerLeave}>Menu {level}</div>, document.body)}
      {level < 3 && <Branch level={level + 1}/>}
    </HoverMenuContext.Provider>;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Branch level={1}/>));
    const first = document.querySelector('[data-level="1"]')!, second = document.querySelector('[data-level="2"]')!, third = document.querySelector('[data-level="3"]')!;
    await act(async () => { move(first, second); vi.advanceTimersByTime(100); move(second, third); vi.advanceTimersByTime(500); });
    expect(document.querySelectorAll('[data-level]')).toHaveLength(3);
    await act(async () => { move(third, host); vi.advanceTimersByTime(500); });
    expect(document.querySelectorAll('[data-level]')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
