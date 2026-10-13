import type { WriteError } from './ipc/types';

/** Shared presentation for native save errors; independent of save orchestration. */
export function getWriteErrorMessage(error: WriteError): string {
  switch (error.kind) {
    case 'permission-denied': return `没有权限写入文件：${error.path}`;
    case 'disk-full': return '磁盘空间不足，无法保存';
    case 'file-locked': return `文件被其他程序锁定：${error.path}`;
    case 'readonly': return `文件是只读的：${error.path}`;
    case 'path-not-found': return `路径不存在：${error.path}`;
    case 'io': return `写入出错：${error.message}`;
  }
}
