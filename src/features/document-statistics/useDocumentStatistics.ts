import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DocumentStatistics } from './documentStatistics';
import type { StatisticsSourceKind } from './documentSourceStatistics';
import { createDocumentSourceCounter } from './documentSourceCounter';
import { getRichDocumentStatistics, subscribeRichDocumentStatistics } from './richDocumentStatistics';
import { createStatisticsScheduler } from './statisticsScheduler';

/** Prefer editor-owned immutable-tree totals; source/plain-text snapshots are debounced and counted off the UI thread. */
export function useDocumentStatistics(key: string | null, kind: string | undefined, content: string | null | undefined, preferRuntime: boolean): DocumentStatistics | null {
  const runtime = useSyncExternalStore(
    useCallback(listener => key ? subscribeRichDocumentStatistics(key, listener) : () => {}, [key]),
    useCallback(() => key ? getRichDocumentStatistics(key) : null, [key]),
  );
  const visualSnapshot = useRef<{ key: string; content: string | null | undefined; value: DocumentStatistics } | null>(null);
  if (key && preferRuntime && runtime) visualSnapshot.current = { key, content, value: runtime };
  const projectedRuntime = preferRuntime ? runtime
    : visualSnapshot.current?.key === key && visualSnapshot.current.content === content ? visualSnapshot.current.value : null;
  const [fallback, setFallback] = useState<{ key: string; value: DocumentStatistics } | null>(null);
  const latest = useRef({ key, kind, content, runtime: projectedRuntime });
  latest.current = { key, kind, content, runtime: projectedRuntime };
  const schedulerRef = useRef<ReturnType<typeof createStatisticsScheduler> | null>(null);
  useEffect(() => {
    if (!key || !['markdown', 'noteboard', 'code'].includes(kind ?? '')) return;
    let generation = 0, disposed = false;
    const counter = createDocumentSourceCounter();
    const scheduler = createStatisticsScheduler(() => {
      const snapshot = latest.current;
      if (snapshot.key !== key || snapshot.content == null || snapshot.runtime) return;
      const request = ++generation;
      void counter.count(snapshot.content, kind as StatisticsSourceKind).then(value => {
        if (!disposed && request === generation && value && latest.current.content === snapshot.content) setFallback({ key, value });
      });
    });
    schedulerRef.current = scheduler; scheduler.schedule();
    return () => { disposed = true; scheduler.dispose(); counter.dispose(); schedulerRef.current = null; };
  }, [key, kind, preferRuntime]);
  useEffect(() => { schedulerRef.current?.schedule(); }, [content]);
  if (!key || content == null || !['markdown', 'noteboard', 'code'].includes(kind ?? '')) return null;
  return projectedRuntime ?? (fallback?.key === key ? fallback.value : null);
}
