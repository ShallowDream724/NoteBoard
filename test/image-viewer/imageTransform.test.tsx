// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/features/image-viewer/ImageViewer';
import { ImageStatusSlot } from '../../src/features/image-viewer/ImageStatusSlot';
import { applyImageTransform, imageTransformCss } from '../../src/features/image/sharedTransform';
import { emit } from '../../src/core/emitter';

const state = vi.hoisted(() => ({ restored: null as Record<string, unknown> | null, capture: null as null | (() => unknown) }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('../../src/core/ipc/commands', () => ({}));
vi.mock('../../src/features/session/editorSuspension', () => ({ takeViewState: () => state.restored }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ registerEditorCapabilities: (capabilities: { captureViewState: () => unknown }) => {
  state.capture = capabilities.captureViewState;
  return () => { state.capture = null; };
} }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.restored = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function loadPreview(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  await act(async () => image.dispatchEvent(new Event('load')));
}

it('keeps flips on output axes after rotation', () => {
  const first = applyImageTransform({ rotation: 0 as const, flipX: false, flipY: false }, 'rotate-cw');
  const both = applyImageTransform(applyImageTransform(first, 'flip-horizontal'), 'flip-vertical');
  expect(both).toEqual({ rotation: 1, flipX: true, flipY: true });
  expect(imageTransformCss(both)).toBe('scaleX(-1) scaleY(-1) rotate(90deg)');
});

it('captures both mirrors and restores legacy degrees through remount without resetting zoom', async () => {
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/image.png" />));
  for (const label of ['顺时针旋转 90°', '水平翻转', '垂直翻转']) {
    await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());
  }
  const saved = state.capture?.() as Record<string, unknown>;
  expect(saved).toMatchObject({ rotation: 90, flipH: true, flipV: true });
  state.restored = { ...saved, scale: 2.5, translate: { x: 10, y: 20 } };
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/image.png" />));
  const img = host.querySelector('img')!;
  await loadPreview(img, 100, 50);
  expect(img.style.transform).toBe('translate(10px, 20px) scale(2.5) scaleX(-1) scaleY(-1) rotate(90deg)');
  expect(state.capture?.()).toMatchObject({ rotation: 90, flipH: true, flipV: true, scale: 2.5 });
  state.restored = { kind: 'image', scale: 1, translate: { x: 0, y: 0 }, rotation: 270, flipH: true, bgMode: 'grid' };
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/image.png" />));
  expect(state.capture?.()).toMatchObject({ rotation: 270, flipH: false, flipV: true });
});

it('shows only the active tab’s original dimensions and live zoom in the shared footer', async () => {
  const render = (active?: string) => act(async () => root.render(<>
    <section id="png"><ImageViewer docKey="png" filePath="/image.png" /></section>
    <section id="jpeg"><ImageViewer docKey="jpeg" filePath="/other.jpeg" /></section>
    <footer>{active && <ImageStatusSlot documentKey={active} />}</footer>
  </>));
  const fields = () => Array.from(host.querySelectorAll('footer .nb-status-field'), field => field.textContent);
  await render('png');
  await loadPreview(host.querySelector('#png img')!, 1920, 1080);
  await loadPreview(host.querySelector('#jpeg img')!, 480, 640);
  for (const label of ['顺时针旋转 90°', '放大']) {
    await act(async () => host.querySelector<HTMLButtonElement>(`#png button[aria-label="${label}"]`)!.click());
  }
  expect(fields()).toEqual(['1920 × 1080 px', '16:9', '125%', 'PNG']);
  expect(host.querySelector('section .nb-status-field')).toBeNull();

  await render('jpeg');
  expect(fields()).toEqual(['480 × 640 px', '3:4', '100%', 'JPEG']);
  await render();
  expect(fields()).toEqual([]);
  await render('png');
  expect(fields()).toEqual(['1920 × 1080 px', '16:9', '125%', 'PNG']);
});

it('clears the displayed source dimensions until a refreshed image decodes', async () => {
  await act(async () => root.render(<>
    <ImageViewer docKey="image" filePath="/image.png" />
    <footer><ImageStatusSlot documentKey="image" /></footer>
  </>));
  const footer = host.querySelector('footer')!;
  const previous = host.querySelector('img')!;
  await loadPreview(previous, 800, 600);
  expect(footer.querySelector('[title="原图分辨率"]')?.textContent).toBe('800 × 600 px');

  await act(async () => emit('image-file-restored', { path: '/image.png' }));
  const refreshed = host.querySelector('img')!;
  expect(refreshed).not.toBe(previous);
  expect(footer.textContent).toBe('PNG');
  await loadPreview(refreshed, 640, 480);
  expect(footer.querySelector('[title="原图分辨率"]')?.textContent).toBe('640 × 480 px');
});
