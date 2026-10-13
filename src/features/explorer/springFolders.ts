import { readExplorerDirectory } from './explorerActions';
import { useExplorerStore } from './explorerStore';
import { isSubPath, normalizePath, sameKey } from './pathUtils';

/** A drag owns only the folders it opened, never the user's existing tree state. */
export function createSpringFolders(workspace: string, isAlive: () => boolean) {
  const opened = new Set<string>(), pending = new Set<Set<string>>();
  let target = '', generation = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => { clearTimeout(timer); timer = undefined; target = ''; generation++; };
  const prune = (paths: Set<string>, keep?: string) => {
    for (const path of paths) {
      if (keep && isSubPath(path, keep)) continue;
      paths.delete(path);
      const state = useExplorerStore.getState();
      if (sameKey(state.root, workspace)) state.collapse(path);
    }
  };
  const unsubscribe = useExplorerStore.subscribe((state, previous) => {
    if (state.rootRevision !== previous.rootRevision) {
      // A replacement tree owns its own expansion state, even after a quick return.
      invalidate();
      if (!sameKey(state.root, previous.root)) {
        opened.clear(); for (const paths of pending) paths.clear();
        return;
      }
      // Moving a directory can revise this same tree while the drop is pending.
      prune(opened);
    }
    if (state.expanded === previous.expanded) return;
    // Once the user closes a spring-opened folder, reopening it is their choice.
    for (const paths of [opened, ...pending]) for (const path of paths) {
      if (!state.expanded.has(normalizePath(path).toLowerCase())) paths.delete(path);
    }
  });
  return {
    hover(directory?: string) {
      if (disposed || !isAlive()) return;
      const next = directory ?? '';
      if (target === next || sameKey(target, next)) return;
      invalidate(); target = next; prune(opened, next);
      if (!next || sameKey(next, workspace) || useExplorerStore.getState().isExpanded(next)) return;
      const token = generation, revision = useExplorerStore.getState().rootRevision;
      timer = setTimeout(() => {
        timer = undefined;
        void readExplorerDirectory(next).then(children => {
          const state = useExplorerStore.getState();
          if (disposed || !isAlive() || generation !== token || state.rootRevision !== revision || state.isExpanded(next)) return;
          opened.add(next); state.expand(next, children);
        }).catch(() => {});
      }, 650);
    },
    clear() { invalidate(); prune(opened); },
    /** The router clears hover immediately; this lease survives until file I/O settles. */
    take(directory: string): (success: boolean) => void {
      invalidate(); prune(opened, directory);
      const paths = new Set(opened); opened.clear(); pending.add(paths);
      return success => {
        if (!pending.delete(paths)) return;
        if (!success) prune(paths);
        paths.clear();
      };
    },
    destroy() {
      invalidate(); prune(opened);
      for (const paths of pending) prune(paths);
      pending.clear(); disposed = true; unsubscribe();
    },
  };
}
