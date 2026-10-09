// NoteBoard 资源管理器 Store
// 单份目录树；手动工作区根与当前标签导航分开
// 详见 docs/05-ADR/ADR-007-资源管理器语义.md
// 详见 docs/07-UI布局与交互规范.md §5

import { create } from 'zustand';
import type { FileTreeNode } from '../../core/ipc/types';
import { sameKey, isSubPath, normalizePath, getPathChain, remapDirectoryPath } from './pathUtils';

interface ExplorerStore {
  /** 当前根路径（null = 未打开任何目录） */
  root: string | null;
  /** Explicitly opened folder; passive file following never replaces it. */
  workspaceRoot: string | null;
  /** Changes even when a root is left and later revisited. */
  rootRevision: number;
  /** 展开的目录集合（路径 → 子节点） */
  expanded: Map<string, FileTreeNode[]>;
  /** Presentation-only file groups; never directory watcher/read targets. */
  associationExpanded: Set<string>;
  /** 当前定位的文件路径（高亮） */
  revealed: string | null;
  /** 定位触发版本计数器（用于通知节点执行滚动） */
  revealCount: number;
  /** 子节点缓存（按目录路径索引） */
  children: Map<string, FileTreeNode[]>;
  /** 是否正在加载 */
  loading: boolean;

  // ── 查询 ──
  isExpanded: (path: string) => boolean;
  getChildren: (path: string) => FileTreeNode[] | undefined;

  // ── 操作 ──
  /** 切换目录展开 */
  toggleExpand: (path: string, children?: FileTreeNode[]) => void;
  /** 展开目录 */
  expand: (path: string, children: FileTreeNode[]) => void;
  /** 收起目录 */
  collapse: (path: string) => void;
  toggleAssociation: (path: string) => void;
  expandAssociation: (path: string) => void;
  /** 设置根路径（跨目录时清空一切） */
  setRoot: (root: string, rootChildren: FileTreeNode[]) => void;
  setWorkspaceRoot: (root: string | null) => void;
  renameDirectory: (oldDir: string, newDir: string) => void;
  /** 定位到文件（高亮并可选择触发滚动） */
  setRevealed: (path: string | null, shouldScroll?: boolean) => void;
  /** 增量更新子节点（监听刷新用） */
  updateChildren: (path: string, children: FileTreeNode[]) => void;
  /** 全量重扫（Flag::Rescan 降级） */
  rescan: (rootChildren: FileTreeNode[]) => void;
  /** 设置 loading */
  setLoading: (loading: boolean) => void;
  /** 清空 */
  clear: () => void;
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  root: null,
  workspaceRoot: null,
  rootRevision: 0,
  expanded: new Map(),
  associationExpanded: new Set(),
  revealed: null,
  revealCount: 0,
  children: new Map(),
  loading: false,

  isExpanded: (path) => get().expanded.has(normalizePath(path).toLowerCase()),

  getChildren: (path) => get().children.get(normalizePath(path).toLowerCase()),

  toggleExpand: (path, children) => {
    const key = normalizePath(path).toLowerCase();
    set((state) => {
      const newExpanded = new Map(state.expanded);
      if (newExpanded.has(key)) {
        newExpanded.delete(key);
      } else if (children) {
        newExpanded.set(key, children);
      }
      return { expanded: newExpanded };
    });
  },

  expand: (path, children) => {
    const key = normalizePath(path).toLowerCase();
    set((state) => {
      if (!isSubPath(state.root, path)) return state;
      const newExpanded = new Map(state.expanded);
      newExpanded.set(key, children);
      const newChildren = new Map(state.children);
      newChildren.set(key, children);
      return { expanded: newExpanded, children: newChildren };
    });
  },

  collapse: (path) => {
    const key = normalizePath(path).toLowerCase();
    set((state) => {
      const newExpanded = new Map(state.expanded);
      newExpanded.delete(key);
      return { expanded: newExpanded };
    });
  },

  toggleAssociation: path => set(state => {
    const associationExpanded = new Set(state.associationExpanded), key = normalizePath(path).toLowerCase();
    if (associationExpanded.has(key)) associationExpanded.delete(key); else associationExpanded.add(key);
    return { associationExpanded };
  }),
  expandAssociation: path => set(state => {
    const key = normalizePath(path).toLowerCase();
    if (state.associationExpanded.has(key)) return state;
    return { associationExpanded: new Set([...state.associationExpanded, key]) };
  }),

  setRoot: (root, rootChildren) => {
    if (sameKey(get().root, root)) {
      get().updateChildren(root, rootChildren);
      return;
    }
    const key = normalizePath(root).toLowerCase();
    set((state) => {
      const newExpanded = new Map<string, FileTreeNode[]>();
      const newChildren = new Map<string, FileTreeNode[]>();
      newChildren.set(key, rootChildren);
      return {
        root,
        rootRevision: state.rootRevision + 1,
        expanded: newExpanded,
        associationExpanded: new Set(),
        children: newChildren,
        revealed: null,
        loading: false,
      };
    });
  },

  setWorkspaceRoot: workspaceRoot => set({ workspaceRoot }),

  renameDirectory: (oldDir, newDir) => {
    const state = get();
    const workspaceRoot = state.workspaceRoot ? remapDirectoryPath(state.workspaceRoot, oldDir, newDir) : null;
    const remapNode = (node: FileTreeNode): FileTreeNode => {
      const path = remapDirectoryPath(node.path, oldDir, newDir);
      return path === node.path ? node : { ...node, path, name: path.split(/[\\/]/).pop() ?? node.name };
    };
    if (state.root && isSubPath(oldDir, state.root)) {
      const children = (state.getChildren(state.root) ?? []).map(remapNode);
      set({ workspaceRoot });
      get().setRoot(remapDirectoryPath(state.root, oldDir, newDir), children);
      return;
    }
    // Drop the renamed branch's old identities; its parent listing stays usable.
    const children = new Map<string, FileTreeNode[]>();
    for (const [path, nodes] of state.children) if (!isSubPath(oldDir, path)) children.set(path, nodes.map(remapNode));
    const expanded = new Map<string, FileTreeNode[]>();
    for (const path of state.expanded.keys()) if (!isSubPath(oldDir, path)) expanded.set(path, children.get(path) ?? []);
    set({ workspaceRoot, children, expanded, rootRevision: state.rootRevision + 1,
      associationExpanded: new Set([...state.associationExpanded].map(path => normalizePath(remapDirectoryPath(path, oldDir, newDir)).toLowerCase())),
      revealed: state.revealed ? remapDirectoryPath(state.revealed, oldDir, newDir) : null });
  },

  // 设置高亮项并选择是否累加定位计数器触发平滑滚动
  setRevealed: (path, shouldScroll = true) =>
    set((state) => ({
      revealed: path,
      revealCount: shouldScroll ? state.revealCount + 1 : state.revealCount,
    })),

  updateChildren: (path, children) => {
    const key = normalizePath(path).toLowerCase();
    set((state) => {
      if (!isSubPath(state.root, path)) return state;
      const newChildren = new Map(state.children);
      newChildren.set(key, children);
      const newExpanded = new Map(state.expanded);
      if (newExpanded.has(key)) newExpanded.set(key, children);
      // Prune only cached branches that were removed from this directory.
      const names = new Set(children.map(node => normalizePath(node.path).toLowerCase()));
      const removed = (state.children.get(key) ?? []).filter(node => node.isDir && !names.has(normalizePath(node.path).toLowerCase()));
      if (removed.length) for (const cached of newChildren.keys()) {
        if (removed.some(node => isSubPath(node.path, cached))) { newChildren.delete(cached); newExpanded.delete(cached); }
      }
      const associationExpanded = new Set(state.associationExpanded);
      const removedFiles = new Set((state.children.get(key) ?? []).filter(node => !node.isDir && !names.has(normalizePath(node.path).toLowerCase())).map(node => normalizePath(node.path).toLowerCase()));
      for (const path of associationExpanded) if (removedFiles.has(path) || removed.some(node => isSubPath(node.path, path))) associationExpanded.delete(path);
      return { children: newChildren, expanded: newExpanded, associationExpanded };
    });
  },

  rescan: (rootChildren) => {
    const root = get().root;
    if (!root) return;
    set(() => {
      // 全量重扫：清空所有缓存，只重新加载根
      const newChildren = new Map<string, FileTreeNode[]>();
      newChildren.set(normalizePath(root).toLowerCase(), rootChildren);
      // 保留 expanded 但清空 children，按需重新加载
      return { children: newChildren };
    });
  },

  setLoading: (loading) => set({ loading }),

  clear: () =>
    set((state) => ({
      root: null,
      workspaceRoot: null,
      rootRevision: state.rootRevision + 1,
      expanded: new Map(),
      associationExpanded: new Set(),
      revealed: null,
      revealCount: 0,
      children: new Map(),
      loading: false,
    })),
}));

export { sameKey, isSubPath, normalizePath, getPathChain };
