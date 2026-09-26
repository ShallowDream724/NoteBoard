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
