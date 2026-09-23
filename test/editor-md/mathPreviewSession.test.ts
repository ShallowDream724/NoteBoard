import { describe, expect, it, vi } from 'vitest';
import { registerMathPreview, setMathPreviewSessionActive } from '../../src/features/editor-md/mathPreviewSession';

const owner = () => document.createElement('div');
const record = (root: HTMLElement, sourceLength = 32) => {
  const prepare = vi.fn(), cancelBackground = vi.fn(), evict = vi.fn(() => true);
  const lease = registerMathPreview(root, { sourceLength, prepare, cancelPreparation: cancelBackground, evict });
  return { lease, prepare, cancelBackground, evict };
};

describe('editor-scoped formula residency', () => {
  it('pauses hidden editor work without releasing its resident DOM', async () => {
    const root = owner(), entry = record(root);
    await Promise.resolve(); entry.lease.nearby(true); entry.lease.mounted(100);
    setMathPreviewSessionActive(root, false); await Promise.resolve();
    expect(entry.cancelBackground).toHaveBeenCalledOnce(); expect(entry.evict).not.toHaveBeenCalled();
    expect(entry.lease.canMount(100)).toBe(false);
    setMathPreviewSessionActive(root, true); expect(entry.lease.isActive()).toBe(true);
    expect(entry.prepare).toHaveBeenCalledTimes(2); entry.lease.dispose();
  });
  it('prepares an Atlas-sized document once after registration, and keeps offscreen results', async () => {
    const root = owner(), entries = Array.from({ length: 466 }, () => record(root));
    expect(entries[0].prepare).not.toHaveBeenCalled();
    await Promise.resolve();
    for (const entry of entries) {
      expect(entry.prepare).toHaveBeenCalledOnce();
      entry.lease.nearby(true); entry.lease.mounted(100); entry.lease.measured(); entry.lease.nearby(false);
    }
    expect(entries.every(entry => entry.evict.mock.calls.length === 0)).toBe(true);
    entries.forEach(entry => entry.lease.dispose());
  });

  it('does not enqueue whole-document preparation for large formula collections or sources', async () => {
    const root = owner(), entries = Array.from({ length: 513 }, () => record(root));
    const long = record(owner(), 65537);
    await Promise.resolve();
    expect(entries.every(entry => entry.prepare.mock.calls.length === 0)).toBe(true);
    expect(long.prepare).not.toHaveBeenCalled();
    entries.forEach(entry => entry.lease.dispose()); long.lease.dispose();
  });

  it('evicts only inactive residents under pressure and does not count pending eviction twice', () => {
    const root = owner(), first = record(root), second = record(root), visible = record(root);
    first.lease.mounted(30000); second.lease.mounted(30000);
    visible.lease.nearby(true); visible.lease.mounted(10000);
    expect(first.evict).toHaveBeenCalledOnce(); expect(second.evict).not.toHaveBeenCalled();
    expect(visible.evict).not.toHaveBeenCalled();
    visible.lease.measured(); expect(first.evict).toHaveBeenCalledOnce();
    first.lease.released(); visible.lease.measured(); expect(second.evict).not.toHaveBeenCalled();
    [first, second, visible].forEach(entry => entry.lease.dispose());
  });

  it('stops speculative preparation at actual DOM capacity, without denying a visible formula', async () => {
    const root = owner(), existing = record(root), next = record(root);
    await Promise.resolve(); existing.lease.mounted(65000);
    expect(next.lease.canMount(1000)).toBe(false);
    await Promise.resolve(); expect(next.cancelBackground).toHaveBeenCalledOnce();
    next.lease.nearby(true); expect(next.lease.canMount(1000)).toBe(true);
    existing.lease.dispose(); next.lease.dispose();
  });

  it('keeps editor sessions independent and does not prepare disposed views', async () => {
    const full = record(owner()), another = record(owner()), removed = record(owner());
    full.lease.mounted(65536); expect(full.lease.canMount(1)).toBe(false);
    removed.lease.dispose(); await Promise.resolve();
    expect(another.prepare).toHaveBeenCalledOnce(); expect(removed.prepare).not.toHaveBeenCalled();
    full.lease.dispose(); another.lease.dispose();
  });
});
