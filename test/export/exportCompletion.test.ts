import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { presentExportedFile } from '../../src/features/export/exportCompletion';
import { openDocument } from '../../src/features/editor-code/orchestration/openDocument';
import { refreshExplorerAfterWrite } from '../../src/features/explorer/refreshAfterWrite';
import { probeDocument, openWithDefaultApp } from '../../src/core/ipc/commands';
import { showToast } from '../../src/stores/toastStore';
vi.mock('../../src/features/editor-code/orchestration/openDocument', () => ({ openDocument: vi.fn() }));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: vi.fn() }));
vi.mock('../../src/core/ipc/commands', () => ({ probeDocument: vi.fn(), openWithDefaultApp: vi.fn() }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openDocument).mockResolvedValue('opened');
  vi.mocked(openWithDefaultApp).mockResolvedValue(undefined);
  vi.mocked(refreshExplorerAfterWrite).mockResolvedValue(undefined);
  vi.mocked(probeDocument).mockResolvedValue({ size: 4096, kind: 'unsupported', isText: false, exists: true, isDir: false });
});
afterEach(() => { vi.restoreAllMocks(); });

it.each(['result.html', 'result.HTM'])('opens exported %s with the OS default application without creating a source tab', async name => {
  const path = `C:\\notes\\${name}`;
  await presentExportedFile(path);
  expect(openWithDefaultApp).toHaveBeenCalledExactlyOnceWith(path);
  expect(openDocument).not.toHaveBeenCalled();
  expect(refreshExplorerAfterWrite).toHaveBeenCalledWith(path);
});

it('an HTML launch failure preserves export success and never opens an unexpected source tab', async () => {
  vi.mocked(openWithDefaultApp).mockRejectedValue(new Error('no association'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await presentExportedFile('C:\\notes\\result.html');
  expect(openDocument).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('导出成功：result.html（4.0 KB）', 'success');
  expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('暂时无法启动默认应用'), 'warning');
});

it('opens the saved file while preserving Explorer and reports its actual byte size', async () => {
  await presentExportedFile('C:\\notes\\result.pdf', 'format warning');
  expect(probeDocument).toHaveBeenCalledExactlyOnceWith('C:\\notes\\result.pdf');
  expect(showToast).toHaveBeenCalledWith('导出成功：result.pdf（4.0 KB）', 'success');
  expect(showToast).toHaveBeenCalledWith('导出提示：format warning', 'warning', 8000);
  expect(openDocument).toHaveBeenCalledWith('C:\\notes\\result.pdf', { exportNotice: { warnings: 'format warning' }, explorer: 'preserve' });
  expect(refreshExplorerAfterWrite).toHaveBeenCalledWith('C:\\notes\\result.pdf');
});

it('metadata failure still reports success and opens the committed file', async () => {
  vi.mocked(probeDocument).mockRejectedValue(new Error('metadata unavailable'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(presentExportedFile('C:\\notes\\result.pdf')).resolves.toBeUndefined();
  expect(showToast).toHaveBeenCalledWith('导出成功：result.pdf', 'success');
  expect(openDocument).toHaveBeenCalledOnce();
});

it('directory refresh failure does not prevent opening the committed file', async () => {
  vi.mocked(refreshExplorerAfterWrite).mockRejectedValue(new Error('directory unavailable'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(presentExportedFile('C:\\notes\\result.pdf')).resolves.toBeUndefined();
  expect(openDocument).toHaveBeenCalledOnce();
  expect(showToast).toHaveBeenLastCalledWith('导出成功：result.pdf（4.0 KB）', 'success');
});

it.each(['failed', 'rejected'] as const)('a %s display never misreports a committed file as a failed export', async outcome => {
  if (outcome === 'failed') vi.mocked(openDocument).mockResolvedValue('failed');
  else vi.mocked(openDocument).mockRejectedValue(new Error('display unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(presentExportedFile('C:\\notes\\result.pdf')).resolves.toBeUndefined();
  expect(showToast).toHaveBeenCalledWith('导出成功：result.pdf（4.0 KB）', 'success');
  expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('文件已导出'), 'warning');
});
