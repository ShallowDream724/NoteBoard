import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SvgDiagramViewport } from '../../src/features/diagram-preview/SvgDiagramViewport';
import { diagramSvgSize } from '../../src/features/diagram-preview/svgSizing';

let root: Root, host: HTMLDivElement;
let resize: ResizeObserverCallback;
let width = 500, nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const svg = '<svg viewBox="0 0 1000 400" width="100%"><rect width="1000" height="400"/></svg>';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  width = 500; nextFrame = 0; frames.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function flushFrame() {
  const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback(0));
}
function wheel(element: Element, deltaY: number, ctrlKey = true) {
  const event = new WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true });
  element.dispatchEvent(event); return event;
}

it('coalesces inline pinch bursts into real layout without React commits or SVG replacement', async () => {
  const commits = vi.fn();
  await act(async () => root.render(<Profiler id="diagram" onRender={commits}><SvgDiagramViewport svg={svg}/></Profiler>));
  const viewport = host.firstElementChild as HTMLDivElement, stage = viewport.firstElementChild as HTMLDivElement;
  const originalSvg = stage.querySelector('svg');
  expect(stage.style.width).toBe('500px'); expect(stage.style.height).toBe('200px');
  commits.mockClear();
  for (let index = 0; index < 10; index++) expect(wheel(viewport, -10).defaultPrevented).toBe(true);
  expect(frames.size).toBe(1); expect(stage.style.height).toBe('200px');
  flushFrame();
  expect(parseFloat(stage.style.width)).toBe(Math.ceil(500 * Math.exp(.8)));
  expect(parseFloat(stage.style.height)).toBe(Math.ceil(200 * Math.exp(.8)));
  expect(viewport.scrollLeft).toBe(0);
  expect(stage.querySelector('svg')).toBe(originalSvg); expect(commits).not.toHaveBeenCalled();
  expect(wheel(viewport, 100, false).defaultPrevented).toBe(false); expect(frames.size).toBe(0);
});

it('refits only when container width changes and preserves scale and the visible horizontal start', async () => {
  await act(async () => root.render(<SvgDiagramViewport svg={svg}/>));
  const viewport = host.firstElementChild as HTMLDivElement, stage = viewport.firstElementChild as HTMLDivElement;
  wheel(viewport, -Math.log(2) / .008); flushFrame(); viewport.scrollLeft = 100;
  width = 300; resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver); flushFrame();
  expect(stage.style.width).toBe('600px'); expect(stage.style.height).toBe('240px'); expect(viewport.scrollLeft).toBe(60);
  resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver); expect(frames.size).toBe(0);
  wheel(viewport, 100000); flushFrame();
  expect(stage.style.width).toBe('60px'); expect(stage.style.height).toBe('24px');
  wheel(viewport, -100000); expect(frames.size).toBe(1);
  await act(async () => root.unmount()); expect(frames.size).toBe(0);
});

it('uses a valid coordinate-space size or absolute dimensions, never percentages as intrinsic pixels', () => {
  const holder = document.createElement('div'); holder.innerHTML = '<svg viewBox="0 0 180 90" width="100%"></svg>';
  const element = holder.firstElementChild!;
  expect(diagramSvgSize(element)).toEqual({ width: 180, height: 90 });
  element.setAttribute('viewBox', '0 0 0 0'); element.setAttribute('width', '180px'); element.setAttribute('height', '90');
  expect(diagramSvgSize(element)).toEqual({ width: 180, height: 90 });
  element.setAttribute('width', '100%'); expect(diagramSvgSize(element)).toBeNull();
});
