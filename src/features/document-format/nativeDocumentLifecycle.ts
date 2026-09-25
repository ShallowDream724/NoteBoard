import { on, off } from '../../core/emitter';
import { recoverNativeCommits } from '../../core/nativeDocumentIO';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { watchDirectory } from '../explorer/directoryWatcher';
import { nativeMarkdownLink, parentDirectory } from './nativeLink';
import { recordNativeAssociation } from './markdownAssociationIndex';
import { checkLinkedMarkdownUpdates, scheduleLinkedMarkdownCheck, clearLinkedMarkdownSession } from './linkedMarkdownUpdates';

/** Bound to open-document lifetime. No content subscription or per-keystroke scans. */
export function startNativeDocumentLifecycle(): () => void {
  const subscriptions = new Map<string, { path: string; release: () => void }>();
  const owners = new Map<string, Set<string>>();
  const identity = (path: string) => path.replace(/\//g, '\\').toLowerCase();
  const remove = ({ key }: { key: string }) => {
    clearLinkedMarkdownSession(key);
    const existing = subscriptions.get(key); if (!existing) return;
    existing.release(); subscriptions.delete(key);
    const keys = owners.get(identity(existing.path)); keys?.delete(key);
    if (!keys?.size) owners.delete(identity(existing.path));
  };
  const update = ({ key }: { key: string }) => {
    const doc = useDocumentStore.getState().getDocument(key);
    if (doc?.kind !== 'noteboard' || doc.content == null) return;
    recordNativeAssociation(key, doc.content);
    const link = nativeMarkdownLink(key, doc.content);
    if (subscriptions.get(key)?.path !== link?.path) {
      remove({ key });
      if (link) {
        subscriptions.set(key, { path: link.path, release: watchDirectory(parentDirectory(link.path)) });
        const keys = owners.get(identity(link.path)) ?? new Set<string>(); keys.add(key); owners.set(identity(link.path), keys);
      }
    }
    if (link) void checkLinkedMarkdownUpdates(key);
  };
  const changed = ({ path }: { path: string }) => { const keys = owners.get(identity(path)); if (keys) scheduleLinkedMarkdownCheck(path, keys); };
  on('document-loaded', update); on('document-saved', update); on('document-session-ended', remove); on('document-file-changed', changed);
  for (const key of useDocumentStore.getState().documents.keys()) update({ key });
  void recoverNativeCommits().then(messages => { if (messages.length) showToast(messages.map(item => item.message).join('\n'), 'warning', 8000); }).catch(error => showToast(`文档恢复未完成：${String(error)}`, 'warning'));
  return () => {
    off('document-loaded', update); off('document-saved', update); off('document-session-ended', remove); off('document-file-changed', changed);
    for (const key of subscriptions.keys()) remove({ key }); owners.clear();
  };
}
