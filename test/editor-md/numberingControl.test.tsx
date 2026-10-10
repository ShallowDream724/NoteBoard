import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlockContinueNumbering, NumberingControl, prepareNumberingTarget } from '@/features/editor-md/numbering/NumberingControl';
import { continueNumbering, createNumberingDraft, getNumberingContext, setNumberingStyle } from '@/features/editor-md/numbering/numbering';
import { NUMBERING_STYLES } from '@/features/editor-md/numbering/styles';

vi.mock('@/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/editor-md/numbering/numbering', () => ({
  continueNumbering: vi.fn(), createNumberingDraft: vi.fn(), getNumberingContext: vi.fn(), setNumberingStyle: vi.fn(),
}));

let root: Root, host: HTMLDivElement, editor: Editor;
const draft = { update: vi.fn((start: number) => start > 0), commit: vi.fn(), cancel: vi.fn(), destroy: vi.fn() };
const context = { available: true, style: 'decimal' as const, start: 1, next: 3, previousText: '上一段的最后一项', currentText: '正在编辑的这一项', canContinue: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getNumberingContext).mockReturnValue(context);
  vi.mocked(createNumberingDraft).mockReturnValue(draft);
  host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
  editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: [StarterKit],
    content: '<ol><li><p>one</p></li><li><p>two</p></li></ol><p>end</p>', editorProps: { handleScrollToSelection: () => true } });
});
afterEach(async () => {
  await act(async () => root.unmount()); editor.destroy(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const startInput = () => document.querySelector<HTMLInputElement>('input[aria-label="重新编号起始值"]')!;
async function open() {
  await act(async () => root.render(<NumberingControl editor={editor} onToggle={() => {}}/>));
  await act(async () => button('有序列表选项').click());
}
async function type(value: string) {
  const input = startInput();
  await act(async () => {
    input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('keeps the primary toggle immediate and only computes numbering context when its arrow opens', async () => {
  const toggle = vi.fn();
  await act(async () => root.render(<NumberingControl editor={editor} onToggle={toggle}/>));
  await act(async () => { button('有序列表').click(); button('有序列表').click(); });
  expect(toggle).toHaveBeenCalledTimes(2); expect(getNumberingContext).not.toHaveBeenCalled();
  expect(startInput()).toBeNull();
  await act(async () => button('有序列表选项').click());
  expect(startInput().value).toBe('1'); expect(createNumberingDraft).not.toHaveBeenCalled();
});

it('keeps native numeric input focused, rolls back invalid drafts and commits a corrected value once', async () => {
  await open(); await type('7'); await type('8'); await type(''); await type('0');
  expect(createNumberingDraft).toHaveBeenCalledOnce();
  expect(draft.update.mock.calls.map(([value]) => value)).toEqual([7, 8]);
  expect(document.activeElement).toBe(startInput()); expect(draft.commit).not.toHaveBeenCalled();
  await type('8');
  await act(async () => startInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(draft.commit).toHaveBeenCalledOnce(); expect(draft.cancel).toHaveBeenCalledOnce();
  expect(createNumberingDraft).toHaveBeenCalledTimes(2);
  expect(startInput()).toBeNull();
  await act(async () => button('有序列表选项').click());
  expect(startInput().value).toBe('1');
});

it('explains an oversized start and never commits the preceding valid preview', async () => {
  await open(); await type('7'); await type('10000000000');
  expect(startInput().getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(startInput().getAttribute('aria-describedby')!)?.textContent).toContain('999,999,999');
  expect(draft.cancel).toHaveBeenCalledOnce(); expect(draft.update).toHaveBeenCalledOnce();
  await act(async () => button('有序列表选项').click());
  expect(draft.commit).not.toHaveBeenCalled();
});

it('applies the default restart of 1 through both the text action and Enter without requiring an edit', async () => {
  await open();
  const restart = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '重新编号')!;
  await act(async () => restart.click());
  expect(draft.update).toHaveBeenLastCalledWith(1); expect(draft.commit).toHaveBeenCalledOnce();
  await act(async () => button('有序列表选项').click());
  expect(createNumberingDraft).toHaveBeenCalledOnce();
  await act(async () => startInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(draft.update).toHaveBeenLastCalledWith(1); expect(draft.commit).toHaveBeenCalledTimes(2);
});

it('cancels the draft on Escape and commits before an application save shortcut bubbles', async () => {
  await open(); await type('4');
  await act(async () => startInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(draft.cancel).toHaveBeenCalledOnce(); expect(draft.commit).not.toHaveBeenCalled();
  await act(async () => button('有序列表选项').click()); await type('5');
  const save = vi.fn(() => expect(draft.commit).toHaveBeenCalledOnce());
  document.addEventListener('keydown', save);
  try { await act(async () => startInput().dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))); }
  finally { document.removeEventListener('keydown', save); }
  expect(save).toHaveBeenCalledOnce(); expect(startInput()).not.toBeNull();
});

it('offers all nine numbering styles in their fixed order and applies the chosen style', async () => {
  await open(); await act(async () => button('编号样式').click());
  const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(choices.map(choice => choice.getAttribute('aria-label'))).toEqual(NUMBERING_STYLES.map(style => style.label));
  expect(choices).toHaveLength(9);
  await act(async () => choices[8].click());
  expect(setNumberingStyle).toHaveBeenCalledWith(editor, 'lower-alpha'); expect(startInput()).toBeNull();
});

it('shows the delayed continuation preview with real neighboring text without changing document or selection', async () => {
  vi.mocked(getNumberingContext).mockReturnValue({ ...context, previousStyle: 'upper-alpha' });
  await open(); vi.useFakeTimers();
  const before = editor.state.doc, selection = editor.state.selection;
  const row = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith('继续编号'))!;
  await act(async () => row.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(499));
  expect(document.querySelector('.nb-numbering-preview')).toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  expect(document.querySelector('.nb-numbering-preview')?.textContent).toContain(context.previousText);
  expect(document.querySelector('.nb-numbering-preview')?.textContent).toContain(context.currentText);
  expect(document.querySelector('.nb-numbering-preview-line > span')?.textContent).toBe('B.');
  expect(editor.state.doc.eq(before)).toBe(true); expect(editor.state.selection.eq(selection)).toBe(true);
  expect(continueNumbering).not.toHaveBeenCalled();
});

it('commits the edited value when focus moves outside the menu', async () => {
  await open(); await type('12');
  const outside = document.body.appendChild(document.createElement('button'));
  await act(async () => outside.focus());
  expect(draft.commit).toHaveBeenCalledOnce(); expect(draft.cancel).not.toHaveBeenCalled();
  expect(startInput()).toBeNull();
});

it('keeps a side multi-row text selection explicit and hides the quick action for continuous lists', async () => {
  editor.commands.setTextSelection({ from: 4, to: 11 });
  const selected = editor.state.selection;
  prepareNumberingTarget(editor, 1);
  expect(editor.state.selection).toBeInstanceOf(TextSelection); expect(editor.state.selection.eq(selected)).toBe(true);
  editor.commands.setTextSelection(3); prepareNumberingTarget(editor, 1);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  vi.mocked(getNumberingContext).mockReturnValue({ ...context, canContinue: false });
  await act(async () => root.render(<BlockContinueNumbering editor={editor} pos={1} close={() => {}}/>));
  expect(host.querySelector('button')).toBeNull();
  expect(getNumberingContext).toHaveBeenCalledWith(editor, 1);
});
