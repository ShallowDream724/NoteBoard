import { confirm } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../stores/settingsStore';

export const DEFAULT_LARGE_FILE_CONFIRM_MB = 50;
const MIB = 1024 * 1024;

/** One policy for disk opens and image imports; inspect metadata before reading bytes. */
export function getLargeFileThresholdBytes(): number {
  const configured = useSettingsStore.getState().settings.file.largeFileConfirmMb;
  return (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LARGE_FILE_CONFIRM_MB) * MIB;
}

export async function confirmLargeFile(name: string, byteSize: number): Promise<boolean> {
  if (byteSize <= getLargeFileThresholdBytes()) return true;
  return confirm(`“${name}”大小为 ${(byteSize / MIB).toFixed(1)} MB，超过设置的大文件确认阈值。是否继续？`, {
    title: '大文件确认', kind: 'warning', okLabel: '继续', cancelLabel: '取消',
  });
}
