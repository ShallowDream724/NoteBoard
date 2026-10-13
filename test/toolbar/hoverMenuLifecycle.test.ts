import { afterEach, expect, it, vi } from 'vitest';
import { retainHoverMenu } from '../../src/components/hoverMenuLifecycle';

const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).forEach(release => release()); vi.restoreAllMocks(); });
function menu(id: string, branch = id) {
  const item = { id, branch, exclusive: true, isOpen: () => true, owns: () => false, pointer: vi.fn(), dismiss: vi.fn() };
  releases.push(retainHoverMenu(item)); return item;
}

it('shares one listener lease across active branches and detaches after the final menu leaves', () => {
  const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
  menu('parent'); menu('child', 'parent child');
  expect(add.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
  releases.shift()!(); expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(0);
  releases.shift()!(); expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
});

it('dismisses only the deepest branch for an unhandled Escape and respects draft prevention', () => {
  const parent = menu('parent'), child = menu('child', 'parent child');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(parent.dismiss).not.toHaveBeenCalled(); expect(child.dismiss).toHaveBeenCalledOnce();
  child.dismiss.mockClear();
  const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); handled.preventDefault(); document.dispatchEvent(handled);
  expect(child.dismiss).not.toHaveBeenCalled();
});
