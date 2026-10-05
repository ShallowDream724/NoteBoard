// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DelimitedPreview } from '../../src/features/editor-code/DelimitedPreview';
import { indexDelimited, readDelimitedCell, readDelimitedWindow } from '../../src/features/editor-code/delimited/parser';
import type { DelimitedSummary, Delimiter } from '../../src/features/editor-code/delimited/parser';
import type { DelimitedSession } from '../../src/features/editor-code/delimited/service';

const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../src/features/editor-code/delimited/service', () => ({ openDelimitedPreview: open }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let sessions: DelimitedSession[];
function makeSession(text: string, delimiter: Delimiter): DelimitedSession {
  const index = indexDelimited(text, delimiter);
  const session = { ready: Promise.resolve(index), readWindow: vi.fn(async range => readDelimitedWindow(text, delimiter, index, range)), readCell: vi.fn(async (row, column) => readDelimitedCell(text, delimiter, index, row, column)), dispose: vi.fn() } satisfies DelimitedSession;
  sessions.push(session); return session;
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  sessions = []; open.mockReset(); open.mockImplementation(makeSession);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) { return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '400'); });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) { return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.width ?? '800'); });
  HTMLElement.prototype.scrollTo = function(options: ScrollToOptions | number = {}, top?: number) {
    if (typeof options === 'number') { this.scrollLeft = options; this.scrollTop = top ?? 0; }
    else { if (options.left !== undefined) this.scrollLeft = options.left; if (options.top !== undefined) this.scrollTop = options.top; }
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(text: string, delimiter: Delimiter = ',') { await act(async () => root.render(<DelimitedPreview text={text} title="data.csv" delimiter={delimiter}/>)); }

it('shows first-row data as text, keeps formulas inert and reveals the full original field', async () => {
  const long = '<script>window.__executed=true</script>' + '长文本😀'.repeat(1000) + '\r\nsecond line';
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await render(`Name,Value\r\n"${long}",=1+1`);
  expect(host.textContent).toContain('2 行 · 2 列');
  expect(Array.from(host.querySelectorAll('[role="columnheader"]')).map(cell => cell.textContent)).toEqual(['行', 'A', 'B']);
  expect(host.textContent).toContain('Name');
  expect(host.querySelector('script')).toBeNull();
  expect((window as unknown as Record<string, unknown>).__executed).toBeUndefined();
  const field = host.querySelector('[aria-rowindex="3"] [aria-colindex="2"]')!;
  await act(async () => field.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector('pre')?.textContent).toBe(long);
  expect(host.textContent).toContain('源码第 2 行');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制单元格完整内容"]')!.click());
  expect(writeText).toHaveBeenCalledWith(long);
  await act(async () => host.querySelector('pre')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('pre')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[role="grid"]'));
});

it('allows the final row and column to be reached without mounting the full matrix', async () => {
  const text = Array.from({ length: 1000 }, (_, row) => Array.from({ length: 30 }, (_, column) => `${row}:${column}`).join(',')).join('\n');
  await render(text);
  expect(host.querySelectorAll('[role="gridcell"]').length).toBeLessThan(400);
  const input = host.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'AD1000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.querySelector('pre')?.textContent).toBe('999:29');
  expect(host.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')).toBe('1001');
  expect(host.querySelector('[role="grid"]')?.getAttribute('aria-colcount')).toBe('31');
  expect(host.querySelectorAll('[role="gridcell"]').length).toBeLessThan(400);
  expect(sessions[0].readWindow).toHaveBeenLastCalledWith(expect.objectContaining({ rowEnd: 1000, columnEnd: 30 }));
});

it('disposes old source sessions and ignores their late initialization results', async () => {
  let resolveOld!: (summary: DelimitedSummary) => void;
  const old = { ready: new Promise<DelimitedSummary>(resolve => { resolveOld = resolve; }), readWindow: vi.fn(), readCell: vi.fn(), dispose: vi.fn() } satisfies DelimitedSession;
  open.mockImplementationOnce(() => { sessions.push(old); return old; });
  await render('old');
  await render('new,a');
  expect(old.dispose).toHaveBeenCalledOnce();
  await act(async () => resolveOld({ rows: 999, columns: 999, raggedRows: 0, sourceUnits: 3, indexBytes: 0 }));
  expect(host.textContent).toContain('1 行 · 2 列');
  expect(host.textContent).not.toContain('999 行');
  await act(async () => root.unmount());
  expect(sessions[1].dispose).toHaveBeenCalledOnce();
});

it('ignores obsolete viewport and full-field results after the source changes', async () => {
  const old = makeSession('old,a', ',');
  let finishWindow!: (rows: ReturnType<typeof readDelimitedWindow>) => void;
  let finishCell!: (cell: ReturnType<typeof readDelimitedCell>) => void;
  vi.mocked(old.readWindow).mockImplementation(() => new Promise(resolve => { finishWindow = resolve; }));
  vi.mocked(old.readCell).mockImplementation(() => new Promise(resolve => { finishCell = resolve; }));
  open.mockImplementationOnce(() => old);
  await render('old,a');
  await act(async () => host.querySelector('[role="gridcell"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await render('new,b');
  await act(async () => {
    finishWindow([{ row: 0, sourceLine: 1, cells: [{ column: 0, value: 'STALE', truncated: false, missing: false }] }]);
    finishCell({ row: 0, column: 0, sourceLine: 1, value: 'STALE', missing: false });
  });
  expect(host.textContent).toContain('new');
  expect(host.textContent).not.toContain('STALE');
  expect(host.querySelector('pre')).toBeNull();
  expect(old.dispose).toHaveBeenCalledOnce();
});

it('offers source fallback after a failure and displays an honest empty state', async () => {
  const showSource = vi.fn();
  open.mockImplementationOnce(() => { throw new Error('文本过大，无法打开表格视图。请查看源码。'); });
  await act(async () => root.render(<DelimitedPreview text="large" title="large.csv" delimiter="," onShowSource={showSource}/>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('文本过大');
  await act(async () => host.querySelector('button')!.click());
  expect(showSource).toHaveBeenCalledOnce();
  await render('');
  expect(host.textContent).toContain('0 行 · 0 列');
  expect(host.textContent).toContain('文件为空');
  expect(host.querySelector('[role="grid"]')).toBeNull();
});
