import { BOOKMARK_COLORS, MAX_DOCUMENT_BOOKMARKS, type DocumentBookmark } from './types';

const LEGACY_KEY = 'noteboard.document-bookmarks.v1';
const DOCUMENT_PREFIX = 'noteboard.document-bookmarks.v2:';
const MAX_CACHED_DOCUMENTS = 200;
const MAX_CACHED_BOOKMARKS = 1000;
interface Entry { updatedAt: number; records: DocumentBookmark[] }
const memory = new Map<string, Entry>();
let legacyMigrated = false;
let storageError: string | null = null;
const pinned = new Set<string>();
const openDocuments = new Set<string>();
const movedIdentities = new Set<string>();
const failedWrites = new Set<string>();
const pendingMigrationSources = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
function setStorageError(error: string | null) {
  if (storageError === error) return;
  storageError = error; listeners.forEach(listener => listener());
}

function validRecord(value: unknown): value is DocumentBookmark {
  if (!value || typeof value !== 'object') return false;
  const record = value as DocumentBookmark;
  return typeof record.id === 'string' && record.id.length <= 80 && Number.isSafeInteger(record.pos) && record.pos >= 0 &&
    Number.isSafeInteger(record.size) && record.size > 0 && typeof record.nodeType === 'string' && record.nodeType.length <= 80 &&
    typeof record.quote === 'string' && record.quote.length <= 160 && typeof record.label === 'string' && record.label.length <= 80 && typeof record.missing === 'boolean' &&
    (record.contextBefore === undefined || typeof record.contextBefore === 'string' && record.contextBefore.length <= 64) &&
    (record.contextAfter === undefined || typeof record.contextAfter === 'string' && record.contextAfter.length <= 64) &&
    (record.kind === undefined || record.kind === 'range') &&
    (record.color === undefined || BOOKMARK_COLORS.some(color => color.value === record.color));
}
function storageKey(docKey: string) { return DOCUMENT_PREFIX + encodeURIComponent(docKey); }
function parseEntry(value: unknown): Entry | undefined {
  if (!value || typeof value !== 'object') return;
  const entry = value as Entry;
  if (!Array.isArray(entry.records) || !Number.isFinite(entry.updatedAt)) return;
  const ids = new Set<string>();
  return { updatedAt: entry.updatedAt, records: entry.records.filter(record => {
    if (!validRecord(record) || ids.has(record.id)) return false;
    ids.add(record.id); return true;
  }).slice(0, MAX_DOCUMENT_BOOKMARKS) };
}
/** Copy old combined metadata once. Existing document entries always win;
 * failed migration retains the complete legacy source. */
function migrateLegacy(): void {
  if (legacyMigrated) return;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) { legacyMigrated = true; return; }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { legacyMigrated = true; return; }
    for (const [docKey, value] of Object.entries(parsed)) {
      const entry = parseEntry(value);
      if (!entry || docKey.length > 32768) continue;
      const key = storageKey(docKey);
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(entry));
    }
    localStorage.removeItem(LEGACY_KEY); legacyMigrated = true;
  } catch { setStorageError('无法迁移本机书签；本次会话中的书签仍可使用。'); }
}
function readEntry(docKey: string): Entry | undefined {
  migrateLegacy();
  if (failedWrites.has(docKey)) return memory.get(docKey);
  try {
    const raw = localStorage.getItem(storageKey(docKey));
    const legacy = !raw && !legacyMigrated ? localStorage.getItem(LEGACY_KEY) : null;
    const entry = raw ? parseEntry(JSON.parse(raw)) : legacy ? parseEntry((JSON.parse(legacy) as Record<string, unknown>)[docKey]) : undefined;
    if (entry) { memory.set(docKey, entry); pruneMemory(docKey); } else if (!pinned.has(docKey)) memory.delete(docKey);
    return entry;
  } catch { setStorageError('无法读取本机书签；本次会话中的书签仍可使用。'); return memory.get(docKey); }
}
/** Limits apply only to inactive memory cache. Durable user bookmarks are
 * never evicted; each write touches only its own document storage key. */
function pruneMemory(currentKey: string): void {
  const entries = [...memory.entries()];
  let count = entries.reduce((sum, [, entry]) => sum + entry.records.length, 0), documents = entries.length;
  for (const [docKey, entry] of entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt)) {
    if (documents <= MAX_CACHED_DOCUMENTS && count <= MAX_CACHED_BOOKMARKS) break;
    if (docKey === currentKey || pinned.has(docKey) || openDocuments.has(docKey) || failedWrites.has(docKey)) continue;
    memory.delete(docKey); documents--; count -= entry.records.length;
  }
}
export function loadBookmarks(docKey: string): DocumentBookmark[] { return readEntry(docKey)?.records.map(record => ({ ...record })) ?? []; }
function releaseMigratedMemory(docKey: string, visited = new Set<string>(), destination = docKey): void {
  if (visited.has(docKey)) return;
  visited.add(docKey);
  const sources = pendingMigrationSources.get(docKey);
  pendingMigrationSources.delete(docKey);
  for (const [source, captured] of sources ?? []) {
    // A path may have reopened and acquired a newer memory-only entry while
    // its former destination was waiting for quota recovery.
    if (memory.get(source) !== captured) continue;
    releaseMigratedMemory(source, visited, destination);
    if (source !== destination && memory.get(source) === captured) { memory.delete(source); failedWrites.delete(source); }
  }
}
function persist(docKey: string, records: readonly DocumentBookmark[]): boolean {
  migrateLegacy();
  const entry = { updatedAt: Date.now(), records: records.map(record => ({ ...record })) };
  if (records.length) memory.set(docKey, entry); else memory.delete(docKey);
  try {
    if (records.length) localStorage.setItem(storageKey(docKey), JSON.stringify(entry)); else localStorage.removeItem(storageKey(docKey));
    failedWrites.delete(docKey); releaseMigratedMemory(docKey); pruneMemory(docKey); if (!failedWrites.size) setStorageError(null); return true;
  } catch { failedWrites.add(docKey); setStorageError('书签未能保存到本机；本次会话中的书签仍可使用。'); return false; }
}
export function saveBookmarks(docKey: string, records: readonly DocumentBookmark[]): boolean {
  return Boolean(docKey && !movedIdentities.has(docKey) && persist(docKey, records));
}
/** Publish the destination first. Failure never removes the durable source;
 * old editor destruction cannot resurrect a moved identity. */
export function migrateBookmarks(from: string, to: string): void {
  if (from === to) return;
  flushers.get(from)?.();
  if (flushers.has(from)) movedIdentities.add(from);
  const entry = memory.get(from) ?? readEntry(from);
  if (!entry) return;
  let removalFailed = false;
  if (persist(to, entry.records)) {
    try { localStorage.removeItem(storageKey(from)); } catch { removalFailed = true; setStorageError('书签身份迁移未能完成；新文档的书签仍可使用。'); }
    memory.delete(from); failedWrites.delete(from);
    if (!removalFailed && !failedWrites.size) setStorageError(null);
  } else {
    const sources = pendingMigrationSources.get(to) ?? new Map<string, Entry>();
    sources.set(from, entry); pendingMigrationSources.set(to, sources);
  }
}
const flushers = new Map<string, () => void | boolean>();
export function registerBookmarkPersistence(docKey: string, flush: () => void | boolean): () => void {
  movedIdentities.delete(docKey); pinned.add(docKey); flushers.set(docKey, flush);
  return () => { if (flushers.get(docKey) === flush) { flushers.delete(docKey); pinned.delete(docKey); movedIdentities.delete(docKey); } };
}
export function getBookmarkStorageError(): string | null { return storageError; }
export function ownsBookmarkPersistence(docKey: string, flush: () => void | boolean): boolean { return flushers.get(docKey) === flush && !movedIdentities.has(docKey); }
export function flushDocumentBookmarks(docKey: string): boolean {
  const flush = flushers.get(docKey);
  if (!flush && failedWrites.has(docKey)) return persist(docKey, memory.get(docKey)?.records ?? []);
  return flush?.() !== false && !failedWrites.has(docKey);
}
export function hasBookmarkPersistence(docKey: string): boolean { return flushers.has(docKey); }
export function hasBookmarkWriteFailure(docKey: string): boolean { return failedWrites.has(docKey); }
/** Includes source-first tabs, which intentionally have no visual plugin. */
export function setOpenBookmarkDocuments(keys: readonly string[]): void {
  openDocuments.clear(); keys.forEach(key => openDocuments.add(key));
}
/** Call only after another window has committed native ownership. */
export function relinquishDocumentBookmarks(docKey: string): void { if (flushers.has(docKey)) movedIdentities.add(docKey); }
export function reportBookmarkStorageError(message: string): void { setStorageError(message); }
export function subscribeBookmarkStorage(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function resetBookmarkStorage(): void {
  memory.clear(); pinned.clear(); openDocuments.clear(); movedIdentities.clear(); failedWrites.clear(); pendingMigrationSources.clear(); flushers.clear(); listeners.clear(); legacyMigrated = false; storageError = null;
}
