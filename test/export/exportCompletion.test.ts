import { beforeEach, expect, it, vi } from 'vitest';
import { presentExportedFile } from '../../src/features/export/exportCompletion';
import { openDocument } from '../../src/features/editor-code/orchestration/openDocument';
import { refreshExplorerAfterWrite } from '../../src/features/explorer/refreshAfterWrite';
import { revealExplorerFile } from '../../src/features/explorer/explorerActions';
import { showToast } from '../../src/stores/toastStore';
vi.mock('../../src/features/editor-code/orchestration/openDocument', () => ({ openDocument: vi.fn() }));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: vi.fn() }));
vi.mock('../../src/features/explorer/explorerActions', () => ({ revealExplorerFile: vi.fn() }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: { getState: () => ({ activeKey: 'C:\\notes\\result.pdf' }) } }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({ documents: new Map([['C:\\notes\\result.pdf', { key: 'C:\\notes\\result.pdf', dirPath: 'C:\\notes' }]]) }) } }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(openDocument).mockResolvedValue('opened'); });
it('opens an exported file with a success receipt and reuses the shared reveal action', async () => {
  await presentExportedFile('C:\\notes\\result.pdf', 'format warning');
  expect(showToast).toHaveBeenCalledWith('导出成功：result.pdf', 'success');
  expect(openDocument).toHaveBeenCalledWith('C:\\notes\\result.pdf', { exportNotice: { warnings: 'format warning' } });
  expect(refreshExplorerAfterWrite).toHaveBeenCalledBefore(vi.mocked(openDocument));
  expect(revealExplorerFile).toHaveBeenCalledWith('C:\\notes\\result.pdf', 'C:\\notes', expect.any(Function));
});
it('a display failure never misreports a committed file as a failed export', async () => {
  vi.mocked(openDocument).mockRejectedValue(new Error('display unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await expect(presentExportedFile('C:\\notes\\result.pdf')).resolves.toBeUndefined(); }
  finally { log.mockRestore(); }
  expect(showToast).toHaveBeenCalledWith('导出成功：result.pdf', 'success');
  expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('文件已导出'), 'warning');
});
