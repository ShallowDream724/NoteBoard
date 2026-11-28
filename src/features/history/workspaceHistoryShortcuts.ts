import { matchesShortcut } from '../../core/shortcutBindings';
import { useWindowStore } from '../../stores/windowStore';
import { showToast } from '../../stores/toastStore';
import { flushPendingDocumentHistory, getDocumentHistoryOrder, redoDocumentHistory, undoDocumentHistory } from './documentHistory';
import {
  guardExplorerOpposite, latestExplorerRedoOrder, latestExplorerUndoOrder, redoExplorerOperation, undoExplorerOperation,
} from '../explorer/explorerMoveHistory';

type Direction = 'undo' | 'redo';
type Candidate = { domain: 'workspace'; order: number } | { domain: 'document'; key: string };
type QueuedShortcut = { direction: Direction; canRun?: () => boolean };

/** Form controls, dialogs and embedded editors keep their own input history. */
function hasLocalHistory(target: Element): boolean {
  if (target.closest('input, textarea, select, [role="dialog"], [role="menu"], [data-shortcuts-suspended], [data-editor-control]')) return true;
  const editor = target.closest('.cm-editor, .ProseMirror');
  if (!editor) return !!target.closest('[contenteditable="true"]');
  return !!editor.parentElement?.closest('.ProseMirror, .cm-editor');
}

const workspaceOrder = (direction: Direction) => direction === 'redo' ? latestExplorerRedoOrder() : latestExplorerUndoOrder();

function chooseHistory(direction: Direction): Candidate | undefined {
  const fileOrder = workspaceOrder(direction);
  const key = useWindowStore.getState().activeKey;
  let docOrder = key ? getDocumentHistoryOrder(key)[direction] : undefined;
  if (direction === 'undo' && key && fileOrder !== undefined && docOrder !== undefined && docOrder > fileOrder) {
    // A buffered edit can cancel itself (type a character then remove it).
    flushPendingDocumentHistory(key);
    docOrder = getDocumentHistoryOrder(key).undo;
  }
  if (fileOrder !== undefined && (docOrder === undefined || fileOrder > docOrder)) {
    return { domain: 'workspace', order: fileOrder };
  }
  if (key && docOrder !== undefined) return { domain: 'document', key };
}

export function bindWorkspaceHistoryShortcuts() {
  const queue: QueuedShortcut[] = [];
  let runningFile: Direction | undefined;
  let disposed = false;

  const report = (direction: Direction, error: unknown) => showToast(
    `无法${direction === 'redo' ? '重做' : '撤销'}：${error instanceof Error ? error.message : String(error)}`, 'error',
  );

  function run(direction: Direction, candidate: Candidate) {
    if (candidate.domain === 'document') {
      if (direction === 'redo') redoDocumentHistory(candidate.key);
      else undoDocumentHistory(candidate.key);
      return;
    }
    runningFile = direction;
    const complete = () => {
      runningFile = undefined;
      drain();
    };
    try {
      const result = direction === 'redo' ? redoExplorerOperation(candidate.order) : undoExplorerOperation(candidate.order);
      void Promise.resolve(result).then(complete, error => { report(direction, error); complete(); });
    } catch (error) {
      report(direction, error);
      complete();
    }
  }

  function drain() {
    while (!disposed && !runningFile && queue.length) {
      const { direction, canRun } = queue.shift()!;
      if (canRun && !canRun()) continue;
      try {
        const candidate = chooseHistory(direction);
        if (candidate) run(direction, candidate);
      } catch (error) {
        report(direction, error);
      }
    }
  }

  const handle = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;
    const redo = matchesShortcut('edit.redo', event);
    if (!redo && !matchesShortcut('edit.undo', event)) return;
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (!target || hasLocalHistory(target)) return;
    const inTree = !!target.closest('.nb-explorer-tree');
    const inDocument = !!target.closest('.nb-document-editors');
    if (!inTree && !inDocument && target !== document.body && target !== document.documentElement) return;

    const direction = redo ? 'redo' : 'undo';
    const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (runningFile) {
      consume();
      if (!event.repeat) {
        let canRun: QueuedShortcut['canRun'];
        if (!queue.length && direction !== runningFile) {
          const fileOrder = workspaceOrder(direction);
          const key = useWindowStore.getState().activeKey;
          const docOrder = key ? getDocumentHistoryOrder(key)[direction] : undefined;
          if (fileOrder !== undefined && (docOrder === undefined || fileOrder > docOrder)) {
            canRun = guardExplorerOpposite(direction, fileOrder);
          }
        }
        queue.push({ direction, canRun });
      }
      return;
    }

    try {
      const candidate = chooseHistory(direction);
      // A focused editor handles text through its native keymap. After a file
      // rekeys the editor, focus can be on the body until the next user action.
      if (candidate?.domain !== 'workspace' && inDocument && target.closest('.ProseMirror, .cm-editor')) return;
      if (!candidate && !inTree) return;
      consume();
      if (candidate && (candidate.domain === 'document' || !event.repeat)) run(direction, candidate);
    } catch (error) {
      consume();
      report(direction, error);
    }
  };
  window.addEventListener('keydown', handle, true);
  return () => {
    disposed = true;
    queue.length = 0;
    window.removeEventListener('keydown', handle, true);
  };
}
