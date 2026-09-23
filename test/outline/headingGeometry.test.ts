import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeadingGeometry } from '../../src/features/outline/headingGeometry';
import type { HeadingItem } from '../../src/features/outline/headingIndex';

class ResizeProbe {
  static current: ResizeProbe;
  readonly observed = new Set<Element>();
  observe = vi.fn((element: Element) => { this.observed.add(element); });
  unobserve = vi.fn((element: Element) => { this.observed.delete(element); });
  disconnect = vi.fn(() => { this.observed.clear(); });
  constructor(private callback: ResizeObserverCallback) { ResizeProbe.current = this; }
  deliver(...elements: Element[]) {
    const entries = elements.filter(element => this.observed.has(element)).map(target => ({ target }) as ResizeObserverEntry);
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

function box(element: HTMLElement, top: () => number) {
  const rect = vi.fn(() => ({ top: top(), bottom: top() + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top(), toJSON() {} }));
  element.getBoundingClientRect = rect;
  element.getClientRects = () => [rect()] as unknown as DOMRectList;
  return rect;
}

function fixture() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const headings: HeadingItem[] = [];
  const nodes = new Map<number, HTMLElement>();
  const resolve = vi.fn((pos: number) => nodes.get(pos) ?? null);
  const geometry = new HeadingGeometry(root, resolve);
  const heading = (parent: HTMLElement, top: () => number) => {
    const element = document.createElement('h2');
    parent.appendChild(element);
    const item = { id: `heading-${headings.length}`, pos: headings.length + 1, text: 'Title', level: 2 };
    headings.push(item);
    nodes.set(item.pos, element);
    return { element, item, rect: box(element, top) };
  };
  const block = (parent: HTMLElement, top: () => number, tag = 'div') => {
    const element = document.createElement(tag);
    parent.appendChild(element);
    box(element, top);
    return element;
  };
  return { root, headings, nodes, resolve, geometry, heading, block };
}

describe('grouped outline geometry', () => {
  const geometries: HeadingGeometry[] = [];
  beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeProbe));
  afterEach(() => {
    for (const geometry of geometries.splice(0)) geometry.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });
  const setup = () => {
    const value = fixture();
    geometries.push(value.geometry);
    return value;
  };

  it('orders table headings by Y and locally refreshes a short cell when its row height stays fixed', () => {
    const f = setup();
    const table = f.block(f.root, () => 100, 'table');
    const row = f.block(table, () => 100, 'tr');
    const left = f.block(row, () => 100, 'td');
    const right = f.block(row, () => 100, 'td');
    let leftSecondY = 180;
    f.heading(left, () => 110);
    const formula = f.block(left, () => 140);
    const second = f.heading(left, () => leftSecondY);
    const third = f.heading(right, () => 120);
    f.heading(right, () => 190);
    const later = f.block(f.root, () => 400);
    const laterFirst = f.heading(later, () => 410);
    f.heading(later, () => 420);
    f.geometry.setHeadings(f.headings);

    expect(f.geometry.at(430)).toBe(f.headings.at(-1)?.id);
    expect(f.geometry.at(185)).toBe(second.item.id);
    const untouchedReads = laterFirst.rect.mock.calls.length;
    f.resolve.mockClear();
    leftSecondY = 220;
    ResizeProbe.current.deliver(formula);

    expect(f.geometry.at(185)).toBe(third.item.id);
    expect(f.geometry.at(430)).toBe(f.headings.at(-1)?.id);
    expect(laterFirst.rect).toHaveBeenCalledTimes(untouchedReads);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('uses the current group position after an earlier formula grows without remeasuring its headings', async () => {
    const f = setup();
    const first = f.heading(f.root, () => 0);
    const formula = f.block(f.root, () => 50);
    let tableY = 100;
    const table = f.block(f.root, () => tableY);
    const one = f.heading(table, () => tableY + 10);
    const two = f.heading(table, () => tableY + 80);
    f.geometry.setHeadings(f.headings);
    expect(f.geometry.at(185)).toBe(two.item.id);
    const reads = [one.rect.mock.calls.length, two.rect.mock.calls.length];
    f.resolve.mockClear();
    const observationCount = ResizeProbe.current.observe.mock.calls.length;

    tableY = 200;
    formula.appendChild(document.createElement('span'));
    await Promise.resolve();
    ResizeProbe.current.deliver(formula, f.root);
    expect(f.geometry.at(185)).toBe(first.item.id);
    expect(f.geometry.at(215)).toBe(one.item.id);
    expect(f.geometry.at(285)).toBe(two.item.id);
    expect([one.rect.mock.calls.length, two.rect.mock.calls.length]).toEqual(reads);
    expect(ResizeProbe.current.observe).toHaveBeenCalledTimes(observationCount);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('resolves a replaced heading DOM once and reuses live references after position mapping', async () => {
    const f = setup();
    const group = f.block(f.root, () => 100);
    const first = f.heading(group, () => 110);
    const second = f.heading(group, () => 180);
    f.geometry.setHeadings(f.headings);
    expect(f.geometry.at(185)).toBe(second.item.id);
    f.resolve.mockClear();
    const replacement = document.createElement('h3');
    box(replacement, () => 120);
    first.element.replaceWith(replacement);
    f.nodes.set(first.item.pos, replacement);
    await Promise.resolve();

    expect(f.geometry.at(115)).toBeNull();
    expect(f.geometry.at(125)).toBe(first.item.id);
    expect(f.resolve.mock.calls).toEqual([[first.item.pos]]);
    f.resolve.mockClear();
    f.geometry.setHeadings(f.headings.map(heading => ({ ...heading, pos: heading.pos + 10 })));
    expect(f.geometry.at(185)).toBe(second.item.id);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('finds distant single-heading groups with logarithmic DOM reads and no resize dependencies', () => {
    const f = setup();
    const entries = Array.from({ length: 1024 }, (_, index) => f.heading(f.root, () => index * 100));
    f.geometry.setHeadings(f.headings);
    expect(f.geometry.at(100_040)).toBe(entries[1000].item.id);
    for (const entry of entries) entry.rect.mockClear();
    f.resolve.mockClear();

    expect(f.geometry.at(340)).toBe(entries[3].item.id);
    expect(entries.reduce((count, entry) => count + entry.rect.mock.calls.length, 0)).toBeLessThanOrEqual(12);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(ResizeProbe.current.observed.size).toBe(0);
    entries[3].element.getClientRects = () => [] as unknown as DOMRectList;
    expect(f.geometry.at(340)).toBe(entries[2].item.id);
  });
});
