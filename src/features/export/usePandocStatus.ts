import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PandocStatus { available: boolean; version: string; resolvedPath: string | null }
interface Detection { path: string; request: number; result?: PandocStatus; error?: string }

/** Detection is transient. An automatically resolved path never becomes an override. */
export function usePandocStatus(path: string) {
  const [request, setRequest] = useState(0);
  const [detection, setDetection] = useState<Detection>();
  useEffect(() => {
    let active = true;
    void invoke<PandocStatus>('pandoc_status', { path }).then(result => {
      if (active) setDetection({ path, request, result });
    }).catch(error => {
      if (active) setDetection({ path, request, error: String(error) });
    });
    return () => { active = false; };
  }, [path, request]);
  const current = detection?.path === path && detection.request === request ? detection : undefined;
  return { result: current?.result, error: current?.error, checking: !current, refresh: () => setRequest(value => value + 1) };
}
