import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImageEditDialog } from './ImageEditDialog';
import { discardImageEditorDraft } from './sessions';
import type { ImageEditorController, ImageEditorOptions } from './types';
export type { ImageEditorOptions, ImageEditorSaveMetadata } from './types';

interface ActiveEditor { key: string; host: HTMLElement; root: Root; controller?: ImageEditorController; previous: HTMLElement | null }
let active: ActiveEditor | undefined;

function detach(owner: ActiveEditor, flush: boolean, restoreFocus: boolean): void {
  if (active !== owner) return;
  if (flush) owner.controller?.suspend();
  active = undefined;
  queueMicrotask(() => {
    owner.root.unmount(); owner.host.remove();
    if (restoreFocus && !active && owner.previous?.isConnected) owner.previous.focus({ preventScroll: true });
  });
}

/** One mounted runtime; suspended tabs keep semantic histories only. */
export async function openImageEditor(options: ImageEditorOptions): Promise<void> {
  if (active) detach(active, true, false);
  const host = document.createElement('div');
  host.dataset.imageEditorPortal = '';
  document.body.append(host);
  const owner: ActiveEditor = { key: options.key, host, root: createRoot(host), previous: document.activeElement as HTMLElement | null };
  active = owner;
  owner.root.render(createElement(ImageEditDialog, {
    options,
    register: (controller: ImageEditorController) => { owner.controller = controller; },
    close: () => detach(owner, false, true),
  }));
}

export function suspendImageEditor(): void { if (active) detach(active, true, false); }
export function discardImageEditor(key: string): void {
  discardImageEditorDraft(key);
  if (active?.key === key) detach(active, false, false);
}
