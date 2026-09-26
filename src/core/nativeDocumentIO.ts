import { invoke } from '@tauri-apps/api/core';
import type { Encoding, Eol } from './ipc/types';
import { normalizeDocumentEol } from './documentText';

export interface NativeFileWrite { mtime: number; size: number }
export interface NativeSaveRequest {
  path: string;
  content: string;
  expectedHash?: string | null;
  createOnly?: boolean;
  markdown?: { path: string; content: string; expectedHash: string; encoding?: Encoding; eol?: Eol };
  removeMarkdown?: { path: string; expectedHash: string };
}
export interface NativeSaveResult {
  ok: boolean;
  native?: NativeFileWrite;
  markdown?: NativeFileWrite;
  error?: { code: string; message: string };
}

/** One persistence boundary for linked documents; callers own editor revisions. */
export function saveNativeBundle(request: NativeSaveRequest): Promise<NativeSaveResult> {
  return invoke('save_native_bundle', { request });
}
export function readNativeHeaders(paths: string[]): Promise<{ path: string; header: string }[]> {
  return invoke('read_native_headers', { paths });
}

export function recoverNativeCommits(): Promise<Array<{ path: string; message: string }>> {
  return invoke('recover_native_commits');
}

/** Same canonical text as the native I/O service. Used only at read/write boundaries. */
export async function documentTextHash(text: string): Promise<string> {
  const normalized = normalizeDocumentEol(text);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
