import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, ToolbarDropdownItem } from '../../src/features/toolbar/ToolbarComponents';
import { TooltipProvider } from '../../src/components/Tooltip';
import { EditorMenuScope, EDITOR_MENU_ACTIVITY, isEditorToolbarMenuOpen } from '../../src/components/EditorMenuScope';
import { TextResetControl } from '../../src/features/toolbar/TextResetControl';
import { ContextualHelpContent } from '../../src/components/contextualHelp';

let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const move = (from: Element, to: Element) => {
  from.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
  to.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: from }));
};
const item = (label: string) => document.querySelector<HTMLElement>(`[role="menuitem"][aria-label="${label}"]`)!;

function Menu({ editor = null, initialOpen = true }: { editor?: Editor | null; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <TooltipProvider><EditorMenuScope editor={editor}>
    <ToolbarDropdown trigger={<button>插入</button>} isOpen={open} onOpenChange={setOpen}>
      <ToolbarDropdownItem label="列表" submenu={<input aria-label="起始编号"/>}/>
      <ToolbarDropdownItem label="表格"/>
      <ToolbarDropdownItem label="代码块" helpKey="block.code"/>
      <ToolbarDropdownItem label="分割线"/>
    </ToolbarDropdown>
  </EditorMenuScope></TooltipProvider>;
}

it('keeps the parent menu open while traversing from a submenu row to lower leaf rows', async () => {
  await act(async () => root.render(<Menu/>));
  await act(async () => { move(document.body, item('列表')); vi.advanceTimersByTime(300); });
  expect(document.querySelector('[aria-label="起始编号"]')).not.toBeNull();
  await act(async () => { move(item('列表'), item('代码块')); vi.advanceTimersByTime(500); });
  expect(item('代码块')).not.toBeNull();
  expect(document.querySelector('[aria-label="起始编号"]')).toBeNull();
  await act(async () => { move(item('代码块'), item('分割线')); vi.advanceTimersByTime(500); });
  expect(item('分割线')).not.toBeNull();
});

it('keeps both portalled menu levels alive while their input owns focus and preserves input arrow keys', async () => {
  await act(async () => root.render(<Menu/>));
  await act(async () => { move(document.body, item('列表')); vi.advanceTimersByTime(300); });
  const input = document.querySelector<HTMLInputElement>('[aria-label="起始编号"]')!;
  expect(input.closest('.nb-editor-menu-overlay')).not.toBeNull();
  await act(async () => { move(item('列表'), input); input.focus(); move(input, document.body); vi.advanceTimersByTime(500); });
  expect(document.activeElement).toBe(input);
  expect(item('分割线')).not.toBeNull();
  const key = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(false);
});

it('dismisses a pointer menu after leaving a focused ordinary action', async () => {
  await act(async () => root.render(<Menu/>));
  await act(async () => { move(document.body, item('代码块')); item('代码块').focus(); move(item('代码块'), document.body); vi.advanceTimersByTime(350); });
  expect(item('代码块')).toBeNull();
});

it('returns an already open keyboard menu to hover dismissal when its trigger is entered by pointer', async () => {
  await act(async () => root.render(<Menu initialOpen={false}/>));
  const trigger = document.querySelector<HTMLElement>('[data-nb-menu-trigger]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  expect(item('代码块')).not.toBeNull();
  await act(async () => { move(document.body, trigger); move(trigger, document.body); vi.advanceTimersByTime(350); });
  expect(item('代码块')).toBeNull();
});

it('dismisses focused input branches on outside pointer without consuming document selection input', async () => {
  await act(async () => root.render(<Menu/>));
  await act(async () => { move(document.body, item('列表')); vi.advanceTimersByTime(300); });
  const input = document.querySelector<HTMLInputElement>('[aria-label="起始编号"]')!;
  await act(async () => input.focus());
  const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => document.body.dispatchEvent(press));
  expect(item('代码块')).toBeNull();
  expect(press.defaultPrevented).toBe(false);
});

it('does not reopen an interrupted hover intention after window focus is lost', async () => {
  await act(async () => root.render(<Menu initialOpen={false}/>));
  const trigger = document.querySelector('[data-nb-menu-trigger]')!;
  await act(async () => move(document.body, trigger));
  await act(async () => { window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(500); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('lets an IME consume Escape without dismissing an open menu', async () => {
  await act(async () => root.render(<Menu/>));
  const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
  await act(async () => item('代码块').dispatchEvent(key));
  expect(item('代码块')).not.toBeNull();
});

it('returns keyboard focus to an Anchor-based toolbar trigger after Escape', async () => {
  await act(async () => root.render(<Menu/>));
  const trigger = document.querySelector<HTMLElement>('[data-nb-menu-trigger]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => { item('代码块').focus(); item('代码块').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); vi.advanceTimersByTime(100); });
  expect(item('代码块')).toBeNull();
  expect(document.activeElement?.textContent).toBe('插入');
});

it('closes the owning menu with one Escape while a keyboard explanation is on top', async () => {
  await act(async () => root.render(<Menu/>));
  const trigger = document.querySelector<HTMLElement>('[data-nb-menu-trigger]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => { item('代码块').focus(); vi.advanceTimersByTime(700); });
  expect(document.querySelector('.nb-contextual-help-content')).not.toBeNull();
  await act(async () => { item('代码块').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); vi.advanceTimersByTime(100); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.querySelector('.nb-contextual-help-content')).toBeNull();
  expect(document.activeElement?.textContent).toBe('插入');
});

it('leases toolbar activity for the owning editor without changing focus or selection', async () => {
  const dom = document.createElement('div'); dom.tabIndex = 0; document.body.append(dom); dom.focus();
  const selection = { from: 2, to: 8 }, dispatch = vi.fn(), activity = vi.fn();
  const editor = { view: { dom, dispatch }, state: { selection }, isDestroyed: false } as unknown as Editor;
  dom.addEventListener(EDITOR_MENU_ACTIVITY, activity);
  await act(async () => root.render(<Menu editor={editor}/>));
  expect(isEditorToolbarMenuOpen(dom)).toBe(true);
  expect(document.activeElement).toBe(dom);
  expect(editor.state.selection).toBe(selection);
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => { move(item('分割线'), document.body); vi.advanceTimersByTime(500); });
  expect(isEditorToolbarMenuOpen(dom)).toBe(false);
  expect(activity).toHaveBeenCalledTimes(2);
});

it('dismisses the split main-action preview as its options start opening', async () => {
  function Reset() {
    const [open, setOpen] = useState(false);
    return <TextResetControl open={open} onOpenChange={setOpen} disabled={false} restoreDisabled={false} onClear={() => {}} onRestore={() => {}} onReturnToEditor={() => {}}/>;
  }
  await act(async () => root.render(<TooltipProvider><Reset/></TooltipProvider>));
  const main = document.querySelector('.nb-text-reset-apply')!, arrow = document.querySelector('.nb-text-reset-expand')!;
  await act(async () => { main.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(660); });
  expect(document.querySelector('[data-help-key="format.clear"]')).not.toBeNull();
  await act(async () => { move(main, arrow); vi.advanceTimersByTime(300); });
  expect(document.querySelector('[data-help-key="format.clear"]')).toBeNull();
  expect(document.querySelector('.nb-text-reset-menu')).not.toBeNull();
});

it('previews inline code using the document code mark within its surrounding paragraph', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="text.code" title="行内代码"/>));
  expect(document.querySelector('.ProseMirror p > code')?.textContent).toBe('npm install');
  expect(document.querySelector('.ProseMirror pre')).toBeNull();
});
