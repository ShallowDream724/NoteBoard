import { useEffect } from 'react';
import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { followExplorerFile } from './explorerActions';

export function useReveal() {
  const activeKey = useWindowStore(s => s.activeKey);
  const directory = useDocumentStore(s => activeKey ? s.documents.get(activeKey)?.dirPath : undefined);
  useEffect(() => {
    if (!activeKey || !directory || activeKey.startsWith('untitled:')) return;
    let disposed = false;
    void followExplorerFile(activeKey, directory, () => !disposed && useWindowStore.getState().activeKey === activeKey)
      .catch(error => console.error('定位文件失败:', error));
    return () => { disposed = true; };
  }, [activeKey, directory]);
}
