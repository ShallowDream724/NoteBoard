import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { TooltipProvider } from './Tooltip';

export function DialogShell({ title, description, children, onDismiss, width = 480 }: {
  title: string; description: string; children: ReactNode; onDismiss: () => void; width?: number;
}) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onDismiss(); }}>
    <Dialog.Portal>
      <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 30%)', zIndex: 10000 }} />
      <Dialog.Content data-shortcuts-suspended style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: `min(${width}px, calc(100vw - 40px))`, boxSizing: 'border-box', padding: 24,
        background: 'var(--editor-surface)', color: 'var(--editor-text)',
        border: '1px solid var(--editor-border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 10001,
      }}>
        <Dialog.Title style={{ margin: '0 30px 10px 0', fontSize: 18 }}>{title}</Dialog.Title>
        <Dialog.Description style={{ margin: '0 0 18px', color: 'var(--editor-text-muted)', lineHeight: 1.6, fontSize: 13 }}>
          {description}
        </Dialog.Description>
        {children}
        <Dialog.Close aria-label="关闭" style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>
          <X size={18} />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** A short-lived, focus-trapped request; business state remains with the caller. */
export function showTransientDialog<T>(render: (finish: (value: T) => void) => ReactNode): Promise<T> {
  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let finished = false;
  return new Promise((resolve) => {
    // This root is outside AppShell's React tree and cannot inherit its providers.
    root.render(<TooltipProvider>{render((value) => {
      if (finished) return;
      finished = true;
      queueMicrotask(() => {
        root.unmount(); host.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(value);
      });
    })}</TooltipProvider>);
  });
}
