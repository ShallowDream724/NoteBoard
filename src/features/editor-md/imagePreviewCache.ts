import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ImagePreviewResult } from './imagePreviewEngine';

const ACTIVE_PIXEL_SOFT_BUDGET = 128 * 1024 * 1024;
const IDLE_BLOB_BUDGET = 8 * 1024 * 1024;
const IDLE_MAX_ENTRIES = 64;
const IDLE_TTL_MS = 30_000;

export function imagePreviewWidth(cssWidth: number, dpr = 1): number {
  const desired = Math.max(1, cssWidth || 1024) * Math.max(1, dpr || 1);
  return Math.min(4096, Math.max(256, Math.ceil(desired / 256) * 256));
}

export function canRequestImagePreview(src: string): boolean {
  return /^data:image\/(?:png|jpeg|webp)[;,]/i.test(src) || /^blob:/i.test(src)
    || /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(src) && /^(?:https?:|asset:)/i.test(src);
}

interface PreviewEntry {
  key: string;
  src: string;
  width: number;
  refs: number;
  state: 'pending' | 'ready' | 'fallback';
  blob: Blob | null;
  pixelBytes: number;
  url: string | null;
  touched: number;
  promise: Promise<string>;
  resolve: (src: string) => void;
}
export interface ImagePreviewLease { readonly result: Promise<string>; release(): void }

/** One worker, individually bounded previews, and a small compressed idle cache.
 * Releasing the last lease always revokes the URL; idle entries retain no bitmap. */
export class ImageDisplayPreviewCache {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly queue: PreviewEntry[] = [];
  private worker: Worker | null = null;
  private active: { id: number; entry: PreviewEntry } | null = null;
  private nextId = 0;
  private pixelBytes = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private idleWorkerTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly createWorker: () => Worker = () => new Worker(new URL('./imagePreviewWorker.ts', import.meta.url), { type: 'module' })) {}

  acquire(src: string, width: number): ImagePreviewLease {
    const key = `${width}:${src}`;
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: (src: string) => void;
      const promise = new Promise<string>(done => { resolve = done; });
      entry = { key, src, width, refs: 0, state: 'pending', blob: null, pixelBytes: 0, url: null, touched: Date.now(), promise, resolve };
      this.entries.set(key, entry);
      this.queue.push(entry);
    }
    entry.refs++;
    entry.touched = Date.now();
    const current = entry;
    const result = current.state === 'pending' ? current.promise : Promise.resolve(this.activate(current));
    this.pump();
    let released = false;
    return { result, release: () => {
      if (released) return;
      released = true;
      current.refs--;
      if (current.refs) return;
      current.touched = Date.now();
      this.revoke(current);
      if (current.state === 'pending') {
        const index = this.queue.indexOf(current);
        if (index !== -1) this.queue.splice(index, 1);
        if (this.active?.entry === current) {
          this.stopWorker();
          this.active = null;
        }
        current.resolve(current.src);
        this.entries.delete(current.key);
        this.pump();
      } else if (/^(?:data:|blob:)/i.test(current.src)) {
        // Do not pin an inline document's source bytes after its view leaves.
        this.entries.delete(current.key);
      }
      this.prune();
    } };
  }

  private activate(entry: PreviewEntry): string {
    if (entry.url) return entry.url;
    if (entry.blob && entry.refs) {
      try {
        entry.url = URL.createObjectURL(entry.blob);
        this.pixelBytes += entry.pixelBytes;
        // Live display resources cannot be evicted without replacing them with
        // a larger original or hiding visible content. Under pressure drop idle
        // cache only; visibility leases release active previews progressively.
        if (this.pixelBytes > ACTIVE_PIXEL_SOFT_BUDGET) this.prune();
        return entry.url;
      } catch { return entry.src; }
    }
    return entry.src;
  }

  private revoke(entry: PreviewEntry): void {
    if (!entry.url) return;
    URL.revokeObjectURL(entry.url);
    entry.url = null;
    this.pixelBytes -= entry.pixelBytes;
  }

  private stopWorker(): void {
    if (this.timeout) clearTimeout(this.timeout);
    if (this.idleWorkerTimer) clearTimeout(this.idleWorkerTimer);
    this.timeout = this.idleWorkerTimer = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private complete(result: ImagePreviewResult | null): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    const entry = active.entry;
    entry.state = result ? 'ready' : 'fallback';
    entry.blob = result?.blob ?? null;
    entry.pixelBytes = result ? result.width * result.height * 4 : 0;
    entry.touched = Date.now();
    entry.resolve(this.activate(entry));
    this.prune();
    this.pump();
  }

  private pump(): void {
    if (this.active) return;
    if (this.idleWorkerTimer) clearTimeout(this.idleWorkerTimer);
    this.idleWorkerTimer = null;
    const entry = this.queue.shift();
    if (!entry) {
      // No worker heap lives with a document after its preview batch is finished.
      if (this.worker) this.idleWorkerTimer = setTimeout(() => this.stopWorker(), 1_000);
      return;
    }
    const id = ++this.nextId;
    this.active = { id, entry };
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<{ id: number; result: ImagePreviewResult | null }>) => {
          if (this.worker === worker && this.active?.id === data.id) this.complete(data.result);
        };
        worker.onerror = () => {
          if (this.worker !== worker) return;
          this.stopWorker();
          this.complete(null);
        };
      }
      this.timeout = setTimeout(() => { this.stopWorker(); this.complete(null); }, 15_000);
      this.worker.postMessage({ id, src: entry.src, width: entry.width });
    } catch { this.stopWorker(); this.complete(null); }
  }

  private prune(): void {
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
    const idle = [...this.entries.values()].filter(entry => !entry.refs && entry.state !== 'pending').sort((a, b) => b.touched - a.touched);
    let bytes = 0;
    const now = Date.now();
    for (let index = 0; index < idle.length; index++) {
      const entry = idle[index];
      const size = entry.blob?.size ?? 0;
      if (this.pixelBytes > ACTIVE_PIXEL_SOFT_BUDGET || bytes + size > IDLE_BLOB_BUDGET || index >= IDLE_MAX_ENTRIES || now - entry.touched >= IDLE_TTL_MS) this.entries.delete(entry.key);
      else bytes += size;
    }
    if ([...this.entries.values()].some(entry => !entry.refs)) this.cacheTimer = setTimeout(() => this.prune(), IDLE_TTL_MS);
  }

  /** Test/window teardown: cancel pending decodes and release every URL/cache. */
  dispose(): void {
    this.stopWorker();
    this.active = null;
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
    for (const entry of this.entries.values()) { this.revoke(entry); entry.resolve(entry.src); }
    this.entries.clear();
    this.queue.length = 0;
  }
}

const previews = new ImageDisplayPreviewCache();

/** Undefined while an eligible image is inspected avoids decoding the full-size
 * original first. Ineligible formats and any failure use the original URL. */
export function useImageDisplayPreview(originalSrc: string, targetWidth: number, visible: boolean, frameRef?: RefObject<HTMLElement | null>): string | undefined {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!visible || !frameRef?.current) return;
    const frame = frameRef.current;
    let frameRequest: number | null = null;
    const measure = () => {
      if (frame.clientWidth > 0) setMeasuredWidth(imagePreviewWidth(frame.clientWidth, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (frameRequest !== null) return;
      frameRequest = requestAnimationFrame(() => { frameRequest = null; measure(); });
    });
    observer.observe(frame);
    return () => { observer.disconnect(); if (frameRequest !== null) cancelAnimationFrame(frameRequest); };
  }, [visible, frameRef]);
  const width = measuredWidth ?? imagePreviewWidth(targetWidth, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const awaitingWidth = Boolean(frameRef && visible && measuredWidth === null);
  const eligible = canRequestImagePreview(originalSrc) && typeof Worker === 'function';
  const key = `${width}:${originalSrc}`;
  const [result, setResult] = useState<{ key: string; src: string } | null>(null);
  const activeLease = useRef<{ key: string; src?: string } | null>(null);
  useEffect(() => {
    if (!visible || !eligible || !originalSrc || awaitingWidth) return;
    let current = true;
    const lease = previews.acquire(originalSrc, width);
    const active = { key, src: undefined as string | undefined };
    activeLease.current = active;
    void lease.result.then(src => { if (current) { active.src = src; setResult({ key, src }); } });
    return () => { current = false; if (activeLease.current === active) activeLease.current = null; lease.release(); };
  }, [visible, eligible, originalSrc, width, key, awaitingWidth]);
  if (!visible || !originalSrc) return undefined;
  return eligible ? result?.key === key && activeLease.current?.src === result.src ? result.src : undefined : originalSrc;
}
