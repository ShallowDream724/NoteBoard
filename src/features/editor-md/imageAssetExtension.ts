import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { reconcileImageAssets } from './imageAssetLifecycle';

export const ImageAssetLifecycle = Extension.create<{ docKey: string }>({
  name: 'imageAssetLifecycle',
  addOptions() { return { docKey: '' }; },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        const removed = new Set<string>();
        const added = new Set<string>();
        for (const transaction of transactions) {
          const isSync = transaction.getMeta('noteboard-document-replacement') === 'sync'
            || (transaction.getMeta('addToHistory') === false
              && transaction.getMeta('noteboard-document-replacement') !== 'history');
          transaction.steps.forEach((step, index) => {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              if (!isSync && oldEnd > oldStart) transaction.docs[index].nodesBetween(oldStart, oldEnd, (node) => {
                if (node.type.name === 'image') removed.add(String(node.attrs.src));
              });
              const after = index + 1 < transaction.docs.length ? transaction.docs[index + 1] : transaction.doc;
              if (newEnd > newStart) after.nodesBetween(newStart, newEnd, (node) => {
                if (node.type.name === 'image') added.add(String(node.attrs.src));
              });
            });
          });
        }
        if (!removed.size && !added.size) return null;
        const current = new Set<string>();
        newState.doc.descendants((node) => { if (node.type.name === 'image') current.add(String(node.attrs.src)); });
        for (const src of current) removed.delete(src);
        const editor = this.editor;
        queueMicrotask(() => reconcileImageAssets(this.options.docKey, removed, added, (src) => {
          if (editor.isDestroyed) return true;
          let found = false;
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'image' && node.attrs.src === src) found = true;
            return !found;
          });
          return found;
        }));
        return null;
      },
    })];
  },
});
