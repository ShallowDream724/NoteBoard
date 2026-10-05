import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from '@/components/Tooltip';
import { setShortcutOverrides } from '@/core/shortcutBindings';
import { HoverMenuContext } from '@/components/useHoverMenu';
import { ContextualHelpContent } from '@/components/contextualHelp';
import { ALERT_META } from '@/features/editor-md/alertPresentation';

let root: Root;
const rich = () => document.querySelector('[data-help-key="block.disclosure"]');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setShortcutOverrides({}); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('mounts an explanation only after sustained hover and releases it on Escape without moving focus', async () => {
  await act(async () => root.render(<TooltipProvider><Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  expect(rich()).toBeNull();
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(640); });
  expect(rich()).toBeNull();
  await act(async () => { vi.advanceTimersByTime(20); });
  expect(rich()).not.toBeNull();
  expect(document.activeElement).toBe(document.body);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(rich()).toBeNull();
});

it('shows the current custom binding on keyboard focus and hides a removed binding', async () => {
  setShortcutOverrides({ 'markdown.heading1': ['Ctrl+Alt+H'] });
  await act(async () => root.render(<TooltipProvider><Tooltip content="标题 1" shortcut="Ctrl+1"><button>标题 1</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); trigger.focus(); });
  expect(document.querySelector('.nb-tooltip-kbd')?.textContent).toBe('Ctrl + Alt + H');
  expect(document.activeElement).toBe(trigger);
  await act(async () => setShortcutOverrides({ 'markdown.heading1': [] }));
  expect(document.querySelector('.nb-tooltip-kbd')).toBeNull();
});

it('keeps the owning menu alive while reading a portalled explanation and dismisses without focusing it', async () => {
  const cancel = vi.fn(), leave = vi.fn();
  await act(async () => root.render(<TooltipProvider><HoverMenuContext.Provider value={{ cancel, leave }}>
    <Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip>
  </HoverMenuContext.Provider></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(660); });
  const card = document.querySelector('.nb-contextual-help-content')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: card }));
    card.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: trigger }));
  });
  expect(cancel).toHaveBeenCalled(); expect(rich()).not.toBeNull();
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => card.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true); expect(rich()).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it('uses each real callout preset and distinguishes table captions from image captions', async () => {
  for (const kind of ['note', 'tip', 'important', 'warning', 'caution'] as const) {
    await act(async () => root.render(<ContextualHelpContent helpKey={`block.callout.${kind}`} title={kind}/>));
    const preview = document.querySelector('.github-alert')!;
    expect(preview.getAttribute('data-alert')).toBe(kind);
    expect(preview.querySelector('.alert-title')?.textContent).toBe(ALERT_META[kind].label);
    expect(preview.querySelector('path')?.getAttribute('d')).toBe(ALERT_META[kind].icon);
    expect(preview.querySelector('.alert-body')?.textContent).toBe('');
  }
  await act(async () => root.render(<ContextualHelpContent helpKey="table.caption" title="表注"/>));
  expect(document.querySelector('table > caption .nb-table-caption')?.textContent).toBe('表 1 · 样本统计');
  expect(document.querySelector('figure')).toBeNull();
  await act(async () => root.render(<ContextualHelpContent helpKey="figure.caption" title="图注"/>));
  expect(document.querySelector('figure .nb-image-caption-text')?.textContent).toBe('图 1 · 图片说明');
  expect(document.querySelector('table')).toBeNull();
});

it('shows the empty formula insertion state without fabricating formula content or editable controls', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="formula.block" title="公式块"/>));
  const source = document.querySelector('textarea')!;
  expect(source.value).toBe(''); expect(source.readOnly).toBe(true); expect(source.tabIndex).toBe(-1);
  expect(source.closest('[inert]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('E = mc');
  expect(document.querySelector('.formula-source-hint')?.textContent).toBe('Enter 换行 · Ctrl+Enter 完成');
  await act(async () => root.render(<ContextualHelpContent helpKey="formula.inline" title="行内公式"/>));
  expect(document.querySelector('.formula-source-text')?.textContent).toBe('');
  expect(Array.from(document.querySelectorAll('.formula-source-delimiter'), element => element.textContent)).toEqual(['$', '$']);
});

it('previews the specific whole-table and cell alignment selected by the menu', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="table.position.right" title="整表居右"/>));
  expect(document.querySelector('table')?.style.marginLeft).toBe('auto');
  expect(document.querySelector('table')?.style.marginRight).toBe('0px');
  await act(async () => root.render(<ContextualHelpContent helpKey="table.cell.horizontal.right" title="文字靠右"/>));
  expect(Array.from(document.querySelectorAll('td'), cell => cell.style.textAlign)).toEqual(['right', 'right', 'right']);
  await act(async () => root.render(<ContextualHelpContent helpKey="table.cell.vertical.bottom" title="文字靠下"/>));
  expect(Array.from(document.querySelectorAll('td'), cell => cell.style.verticalAlign)).toEqual(['bottom', 'bottom', 'bottom']);
});
