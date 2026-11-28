import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getDocumentRevision,
  getEditorCapabilities,
  subscribeDocumentRevisions,
  subscribeEditorCapabilities,
} from '../../core/editor/editorRegistry';
import type { CodeNavigationCapabilities, CodeSymbol, CodeSymbolIndex } from '../../core/editor/editorTypes';
import type { LanguageId } from '../../core/ipc/types';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { useWindowStore } from '../../stores/windowStore';
import type { QuickNavigation } from './quickAccessItems';

const symbolKinds: Record<CodeSymbol['kind'], string> = {
  function: '函数', class: '类', type: '类型', section: '节', key: '键', id: '元素 ID',
};

interface LoadedIndex {
  navigation: CodeNavigationCapabilities;
  revision: number;
  language: LanguageId | undefined;
  index: CodeSymbolIndex | null;
}

export function useCodeQuickNavigation(docKey: string | null, enabled: boolean) {
  const language = useDocumentStore(store => docKey ? store.documents.get(docKey)?.language : undefined);
  const navigation = useSyncExternalStore(
    useCallback(notify => docKey ? subscribeEditorCapabilities(key => { if (key === docKey) notify(); }) : () => {}, [docKey]),
    () => docKey ? getEditorCapabilities(docKey)?.codeNavigation ?? null : null,
  );
  const revision = useSyncExternalStore(
    useCallback(notify => docKey && enabled ? subscribeDocumentRevisions(key => { if (key === docKey) notify(); }) : () => {}, [docKey, enabled]),
    () => docKey ? getDocumentRevision(docKey) : 0,
  );
  const [loaded, setLoaded] = useState<LoadedIndex>();

  useEffect(() => {
    if (!navigation || !enabled) return;
    let current = true;
    void navigation.readSymbols().then(
      index => { if (current) setLoaded({ navigation, revision, language, index }); },
      () => { if (current) setLoaded({ navigation, revision, language, index: null }); },
    );
    return () => { current = false; };
  }, [navigation, revision, language, enabled]);

  const canReturn = enabled && navigation?.canReturn();
  return useMemo(() => {
    const items: QuickNavigation[] = [];
    if (!docKey || !navigation || !enabled) return { available: !!navigation, items };

    const isCurrent = () => useWindowStore.getState().activeKey === docKey
      && getEditorCapabilities(docKey)?.codeNavigation === navigation;
    if (canReturn) items.push({
      id: 'return', type: 'return', label: '返回跳转前的位置',
      run: () => { if (isCurrent()) navigation.returnToPrevious(); },
    });

    if (loaded?.navigation !== navigation || loaded.language !== language || loaded.revision !== revision) {
      return { available: true, items, status: '正在查找代码符号…', searching: true };
    }
    const { index } = loaded;
    if (!index) return { available: true, items, status: '无法读取当前文档的代码符号' };

    for (const symbol of index.symbols) items.push({
      id: `symbol:${symbol.kind}:${symbol.position}`,
      type: 'symbol',
      label: symbol.kind === 'id' ? `#${symbol.label}` : symbol.label,
      detail: `${symbolKinds[symbol.kind]} · 第 ${symbol.line} 行`,
      run: () => {
        if (isCurrent() && !index.jump(symbol)) showToast('文档已变更，请重新查找代码符号', 'warning');
      },
    });
    return { available: true, items, status: index.limited ? '已达到代码符号查找上限，部分符号未列出' : undefined };
  }, [canReturn, docKey, enabled, language, loaded, navigation, revision]);
}
