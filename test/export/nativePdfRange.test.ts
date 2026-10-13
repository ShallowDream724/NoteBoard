// @vitest-environment node
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { NativePdfRange } from '../../src/features/export/nativePdfRange';
import type { PdfReceipt } from '../../src/features/export/model';

type ReadRequest = { id: string; revision: number; offset: number; length: number };
const { read } = vi.hoisted(() => {
  // Range transport needs no drawing API; PDF.js initializes one matrix at import.
  vi.stubGlobal('DOMMatrix', class {});
  return { read: vi.fn<(command: string, request: ReadRequest) => Promise<ArrayBuffer>>() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: read }));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { read.mockReset(); });
const MiB = 1024 * 1024;
const receipt: PdfReceipt = { id: 'print', revision: 3, size: MiB * 4, pages: 1, locations: [], issues: [], adjustable: [] };
function deferred() {
  let resolve!: (data: ArrayBuffer) => void, reject!: (error: unknown) => void;
  const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const fail = vi.fn(), received = vi.fn();
  const range = new NativePdfRange(receipt, fail);
  range.transportReady(received);
  return { range, fail, received };
}

it('delivers one complete PDF.js response while bounding each native transfer', async () => {
  read.mockImplementation(async (_command, { offset, length }) => new Uint8Array(length).fill(Math.floor(offset / MiB) + 1).buffer);
  const { range, fail, received } = setup();
  range.requestDataRange(64, MiB * 2 + 81);
  await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
  const response = received.mock.calls[0][0] as { type: string; begin: number; chunk: Uint8Array };
  expect(response.type).toBe('range'); expect(response.begin).toBe(64);
  expect(response.chunk.byteLength).toBe(MiB * 2 + 17);
  expect([response.chunk[0], response.chunk[MiB - 1], response.chunk[MiB], response.chunk[2 * MiB]]).toEqual([1, 1, 2, 3]);
  expect(read.mock.calls.map(([, request]) => request)).toEqual([
    { id: 'print', revision: 3, offset: 64, length: MiB },
    { id: 'print', revision: 3, offset: MiB + 64, length: MiB },
    { id: 'print', revision: 3, offset: 2 * MiB + 64, length: 17 },
  ]);
  expect(fail).not.toHaveBeenCalled();
});

it('passes a small native buffer through without an extra copy', async () => {
  const buffer = new ArrayBuffer(100); read.mockResolvedValue(buffer);
  const { range, received } = setup(); range.requestDataRange(0, 100);
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
  expect(received.mock.calls[0][0].chunk.buffer).toBe(buffer);
});

it('preserves creation order for same-start requests but allows independent ranges', async () => {
  const first = deferred();
  read.mockImplementation(async (_command, { offset, length }) => offset === 0 && length === 100 ? first.promise : new ArrayBuffer(length));
  const { range, received } = setup();
  range.requestDataRange(0, 100); range.requestDataRange(0, 200); range.requestDataRange(10, 30);
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
  expect(read.mock.calls.map(([, request]) => request.length)).toEqual([100, 20]);
  first.resolve(new ArrayBuffer(100));
  await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(3));
  expect(received.mock.calls.map(([event]) => [event.begin, event.chunk.byteLength])).toEqual([[10, 20], [0, 100], [0, 200]]);
});

it.each(['resolve', 'reject'] as const)('ignores a late %s after abort and does not start another fragment', async outcome => {
  const pending = deferred(); read.mockReturnValue(pending.promise);
  const { range, fail, received } = setup(); range.requestDataRange(0, MiB + 20); range.abort();
  if (outcome === 'resolve') pending.resolve(new ArrayBuffer(MiB)); else pending.reject(new Error('old read failed'));
  await pending.promise.catch(() => {}); await new Promise(resolve => setTimeout(resolve, 0));
  expect(read).toHaveBeenCalledOnce(); expect(received).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
});

it('fails once on a short read and never hands partial data to PDF.js', async () => {
  read.mockResolvedValue(new ArrayBuffer(99));
  const { range, fail, received } = setup(); range.requestDataRange(0, 100);
  await vi.waitFor(() => expect(fail).toHaveBeenCalledOnce());
  expect(String(fail.mock.calls[0][0])).toContain('读取不完整');
  range.requestDataRange(100, 200);
  expect(read).toHaveBeenCalledOnce(); expect(received).not.toHaveBeenCalled();
});

it('reports native failures and rejects invalid ranges before native IO', async () => {
  read.mockRejectedValue(new Error('missing revision'));
  const first = setup(); first.range.requestDataRange(0, 100);
  await vi.waitFor(() => expect(first.fail).toHaveBeenCalledOnce());
  expect(first.received).not.toHaveBeenCalled();
  const invalid = setup(); invalid.range.requestDataRange(-1, 100);
  expect(invalid.fail).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
});
