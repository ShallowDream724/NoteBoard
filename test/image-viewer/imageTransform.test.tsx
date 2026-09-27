// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/features/image-viewer/ImageViewer';
import { applyImageTransform, imageTransformCss } from '../../src/features/image/sharedTransform';

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
  Object.defineProperties(img, { naturalWidth: { value: 100 }, naturalHeight: { value: 50 } });
  await act(async () => img.dispatchEvent(new Event('load')));
  expect(img.style.transform).toBe('translate(10px, 20px) scale(2.5) scaleX(-1) scaleY(-1) rotate(90deg)');
  expect(state.capture?.()).toMatchObject({ rotation: 90, flipH: true, flipV: true, scale: 2.5 });
  state.restored = { kind: 'image', scale: 1, translate: { x: 0, y: 0 }, rotation: 270, flipH: true, bgMode: 'grid' };
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/image.png" />));
  expect(state.capture?.()).toMatchObject({ rotation: 270, flipH: false, flipV: true });
});
