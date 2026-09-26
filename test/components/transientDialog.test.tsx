import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { showTransientDialog } from '../../src/components/TransientDialog';
import { LinkModal } from '../../src/features/editor-md/LinkModal';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('opens the real link dialog in an independent root and resolves cancellation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let result!: Promise<null>;
  await act(async () => {
    result = showTransientDialog<null>(finish => <LinkModal isOpen onClose={() => finish(null)} onConfirm={() => finish(null)}/>);
  });
  expect(document.body.textContent).toContain('插入超链接');
  expect(document.querySelectorAll('input').length).toBe(2);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(await result).toBeNull();
  expect(document.querySelector('input')).toBeNull();
});
it('restores the previous focus without scrolling its ancestors', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const button = document.createElement('button'); document.body.appendChild(button); button.focus();
  const focus = vi.spyOn(button, 'focus');
  let finish!: (value: null) => void;
  await act(async () => { showTransientDialog<null>(resolve => { finish = resolve; return <div/>; }); });
  await act(async () => { finish(null); });
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});
it('leaves focus restoration to a caller that owns the resulting editor selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const button = document.createElement('button'); document.body.appendChild(button); button.focus();
  const focus = vi.spyOn(button, 'focus');
  let finish!: (value: null) => void;
  await act(async () => { showTransientDialog<null>(resolve => { finish = resolve; return <div/>; }, { restoreFocus: false }); });
  await act(async () => { finish(null); });
  expect(focus).not.toHaveBeenCalled();
});
