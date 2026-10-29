import { afterEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { bindRichDocumentStatistics, getRichDocumentStatistics, subscribeRichDocumentStatistics } from '../../src/features/document-statistics/richDocumentStatistics';
import { createStatisticsScheduler } from '../../src/features/document-statistics/statisticsScheduler';

afterEach(() => vi.useRealTimers());
describe('statistics lifecycle', () => {
  it('bounds continuous typing latency and cancels pending work on disposal', () => {
    vi.useFakeTimers(); const run = vi.fn(), scheduler = createStatisticsScheduler(run);
    for (let index = 0; index < 6; index++) { scheduler.schedule(); vi.advanceTimersByTime(100); }
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose(); vi.runAllTimers(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('ignores caret-only updates, follows body updates and protects replacement owners during cleanup', () => {
    vi.useFakeTimers();
    const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
    const events = new Map<string, Set<() => void>>();
    const fake = { state: { doc: schema.node('doc', null, schema.node('paragraph', null, schema.text('Hello'))) }, isDestroyed: false,
      on(name: string, callback: () => void) { const callbacks = events.get(name) ?? new Set(); callbacks.add(callback); events.set(name, callbacks); },
      off(name: string, callback: () => void) { events.get(name)?.delete(callback); } };
    const changed = vi.fn(), unsubscribe = subscribeRichDocumentStatistics('statistics-test', changed);
    const dispose = bindRichDocumentStatistics('statistics-test', fake as unknown as Editor);
    vi.advanceTimersByTime(120); expect(getRichDocumentStatistics('statistics-test')).toEqual({ characters: 5, words: 1 });
    changed.mockClear(); events.get('transaction')?.forEach(callback => callback()); vi.advanceTimersByTime(500); expect(changed).not.toHaveBeenCalled();
    fake.state.doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('中文')));
    events.get('transaction')?.forEach(callback => callback()); vi.advanceTimersByTime(120);
    expect(getRichDocumentStatistics('statistics-test')).toEqual({ characters: 2, words: 2 });
    const replacement = bindRichDocumentStatistics('statistics-test', fake as unknown as Editor); dispose(); vi.advanceTimersByTime(120);
    expect(getRichDocumentStatistics('statistics-test')).toEqual({ characters: 2, words: 2 });
    replacement(); expect(getRichDocumentStatistics('statistics-test')).toBeNull();
    expect(events.get('transaction')?.size).toBe(0); expect(events.get('destroy')?.size).toBe(0); unsubscribe();
  });
});
