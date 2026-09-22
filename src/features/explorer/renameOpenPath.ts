import { getCurrentWindow } from '@tauri-apps/api/window';
import * as ipc from '../../core/ipc/commands';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { assertDocumentIdentity, commitDocumentIdentity, materializeIdentityPending, prepareDocumentIdentity, protectDocumentIdentity, type DocumentIdentityLease } from '../session/documentIdentity';
import { isSubPath, normalizePath, sameKey } from './pathUtils';

/** Rename the filesystem entry and all captured local identities without saving. */
export async function renameOpenPath(from: string, to: string, directory: boolean): Promise<void> {
  const source = normalizePath(from), destination = normalizePath(to);
  const matches = (key: string) => directory ? isSubPath(source, key) : sameKey(source, key);
  const allKeys = new Set([...useDocumentStore.getState().documents.keys(), ...useWindowStore.getState().tabs.map(tab => tab.key)]);
  const keys = [...allKeys].filter(matches);
  const moves = keys.map(key => ({ from: key, to: directory ? destination + normalizePath(key).slice(source.length) : destination }));
  for (const move of moves) {
    if ([...allKeys].some(key => !keys.includes(key) && sameKey(key, move.to))) throw new Error('目标路径已有打开的文档');
  }
  const leases: DocumentIdentityLease[] = [];
  try {
    for (const key of keys) leases.push(protectDocumentIdentity(key));
    for (const lease of leases) await prepareDocumentIdentity(lease);
    leases.forEach(assertDocumentIdentity);
    const currentKeys = new Set([...useDocumentStore.getState().documents.keys(), ...useWindowStore.getState().tabs.map(tab => tab.key)]);
    if ([...currentKeys].some(key => matches(key) && !allKeys.has(key))) throw new Error('重命名期间有文档刚被打开，请稍后重试');
    // Native validates the complete registered source set under the same lock as
    // the rename. A concurrent open/foreign owner cancels before touching disk.
    await ipc.renamePath(getCurrentWindow().label, source, destination, keys);
    try {
      // Validate every pending body before committing the first local identity.
      // A failed serialization leaves all source sessions intact for retry.
      moves.forEach(move => materializeIdentityPending(move.from));
    } catch (error) {
      await ipc.renamePath(getCurrentWindow().label, destination, source, moves.map(move => move.to));
      throw error;
    }
    // No await after the filesystem commit: consume pending while its original
    // generation is valid, then publish each new document/tab identity together.
    for (const move of moves) {
      const name = move.to.split(/[\\/]/).pop() ?? move.to;
      const parent = move.to.slice(0, move.to.lastIndexOf('\\'));
      commitDocumentIdentity(move.from, move.to, () => {
        useDocumentStore.getState().renameDocument(move.from, move.to, name, parent);
        useWindowStore.getState().updateTabPath(move.from, move.to, name);
        const doc = useDocumentStore.getState().getDocument(move.to);
        if (doc) useWindowStore.getState().setTabDirty(move.to, doc.isDirty);
      });
    }
  } finally {
    leases.forEach(lease => lease.release());
  }
}
