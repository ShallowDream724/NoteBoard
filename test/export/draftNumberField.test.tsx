import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DraftNumberField } from '../../src/features/export/DraftNumberField';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps replacement digits as a draft and commits the complete value on blur', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  try {
    await act(async () => root.render(<DraftNumberField label="正文字号" value={10.5} min={8} max={24} step={0.5} onCommit={onCommit}/>));
    const input = host.querySelector('input')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.focus();
    await type('1');
    expect(input.value).toBe('1');
    expect(onCommit).not.toHaveBeenCalled();
    await type('16');
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => input.blur());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(16);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('restores an incomplete value and clamps an out-of-range value only on commit', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  try {
    await act(async () => root.render(<DraftNumberField label="正文字号" value={10.5} min={8} max={24} step={0.5} onCommit={onCommit}/>));
    const input = host.querySelector('input')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.focus();
    await type('');
    await act(async () => input.blur());
    expect(input.value).toBe('10.5');
    expect(onCommit).not.toHaveBeenCalled();
    input.focus();
    await type('30');
    await act(async () => input.blur());
    expect(input.value).toBe('24');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(24);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
