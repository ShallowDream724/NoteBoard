// NoteBoard 资源管理器：树数据加载
// 按需加载子节点，不递归预读
// 详见 docs/09-开发路线图.md 5.2

import { useCallback } from 'react';
import type { FileTreeNode } from '../../core/ipc/types';
import { useExplorerStore } from './explorerStore';
import { readExplorerDirectory } from './explorerActions';

/**
 * 按需加载子节点 hook
 */
export function useTreeData() {
  const expand = useExplorerStore((s) => s.expand);
  const collapse = useExplorerStore((s) => s.collapse);
  const isExpanded = useExplorerStore((s) => s.isExpanded);
  const getChildren = useExplorerStore((s) => s.getChildren);
  const loading = useExplorerStore((s) => s.loading);
  const setLoading = useExplorerStore((s) => s.setLoading);

  /** 加载目录的子节点 */
  const loadChildren = useCallback(
    async (dirPath: string): Promise<FileTreeNode[]> => {
      try {
        const nodes = await readExplorerDirectory(dirPath);
        // 排序已经在 Rust 侧完成（目录优先 + 自然排序）
        return nodes;
      } catch (e) {
        console.error('加载目录失败:', dirPath, e);
        return [];
      }
    },
    [],
  );

  /** 切换展开/收起 */
  const toggle = useCallback(
    async (dirPath: string) => {
      if (isExpanded(dirPath)) {
        collapse(dirPath);
        return;
      }

      // 需要加载
      const rootRevision = useExplorerStore.getState().rootRevision;
      setLoading(true);
      const children = await loadChildren(dirPath);
      if (useExplorerStore.getState().rootRevision !== rootRevision) return;
      setLoading(false);
      expand(dirPath, children);
    },
    [isExpanded, collapse, setLoading, expand, loadChildren],
  );

  return {
    toggle,
    loadChildren,
    isExpanded,
    getChildren,
    loading,
  };
}
