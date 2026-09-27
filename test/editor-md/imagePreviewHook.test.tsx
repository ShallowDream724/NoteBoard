import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useImageDisplayPreview } from '../../src/features/editor-md/imagePreviewCache';

class PreviewWorker {
  static instances: PreviewWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { PreviewWorker.instances.push(this); }
  finish() {
    const id = this.postMessage.mock.calls.at(-1)![0].id;
    this.onmessage?.({ data: { id, result: { blob: new Blob(['preview']), width: 1024, height: 576 } } } as MessageEvent);
  }
}
function Harness({ visible }: { visible: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const src = useImageDisplayPreview('https://fixture/preview-hook.png', 1200, visible, frame);
  return <div ref={node => { frame.current = node; if (node) Object.defineProperty(node, 'clientWidth', { configurable: true, value: 480 }); }}><img src={src} /></div>;
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  PreviewWorker.instances = [];
  vi.stubGlobal('Worker', PreviewWorker);
  vi.stubGlobal('devicePixelRatio', 2);
  let index = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:hook-${++index}`);
    static revokeObjectURL = vi.fn();
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.advanceTimersByTime(31_000);
  host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('measures the actual collection frame and never remounts a revoked preview when it becomes visible again', async () => {
  await act(async () => root.render(<Harness visible />));
  const worker = PreviewWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledOnce();
  expect(worker.postMessage.mock.calls[0][0].width).toBe(1024);
  expect(host.querySelector('img')!.hasAttribute('src')).toBe(false);
  await act(async () => worker.finish());
  expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:hook-1');
  await act(async () => root.render(<Harness visible={false} />));
  expect(host.querySelector('img')!.hasAttribute('src')).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:hook-1');
  await act(async () => root.render(<Harness visible />));
  expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:hook-2');
  expect(worker.postMessage).toHaveBeenCalledOnce();
});
