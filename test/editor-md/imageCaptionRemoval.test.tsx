import { beforeEach, expect, it, vi } from 'vitest';
import { resolveImageCaptionRemoval } from '../../src/features/editor-md/imageCaptionRemoval';
import { showTransientDialog } from '../../src/components/TransientDialog';
import { showToast } from '../../src/stores/toastStore';

const mock = vi.hoisted(() => ({ policy: 'ask', setFile: vi.fn() }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { file: { imageCaptionDeletionPolicy: mock.policy } }, setFile: mock.setFile }) } }));
vi.mock('../../src/components/TransientDialog', () => ({ DialogShell: () => null, showTransientDialog: vi.fn() }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); mock.policy = 'ask'; mock.setFile.mockResolvedValue(undefined); });

it('asks only for attached content and leaves cancellation unchanged', async () => {
  expect(await resolveImageCaptionRemoval({ hasCaption: false })).toBe('remove');
  expect(showTransientDialog).not.toHaveBeenCalled();
  vi.mocked(showTransientDialog).mockResolvedValue({ action: null, remember: false });
  expect(await resolveImageCaptionRemoval({ hasCaption: false, hasAnnotations: true })).toBeNull();
  expect(mock.setFile).not.toHaveBeenCalled();
});
it.each(['keep', 'remove'])('uses remembered %s content choice without asking about files', async policy => {
  mock.policy = policy;
  expect(await resolveImageCaptionRemoval({ hasCaption: true, hasAnnotations: true })).toBe(policy);
  expect(showTransientDialog).not.toHaveBeenCalled();
});
it('stores only the caption preference and retains the current choice if persistence fails', async () => {
  vi.mocked(showTransientDialog).mockResolvedValue({ action: 'keep', remember: true });
  mock.setFile.mockRejectedValue(new Error('disk full'));
  expect(await resolveImageCaptionRemoval({ hasCaption: true })).toBe('keep');
  expect(mock.setFile).toHaveBeenCalledWith({ imageCaptionDeletionPolicy: 'keep' });
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('偏好未能保存'), 'error');
});
