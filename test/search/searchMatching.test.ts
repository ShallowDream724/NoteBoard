import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectRegexMatches } from '../../src/features/search/regexMatchingEngine';
import { REGEX_SEARCH_LIMITS, type RegexSearchRequest, type RegexSearchResult } from '../../src/features/search/regexProtocol';
import { searchRegex } from '../../src/features/search/searchMatching';

const request = (text: string, pattern: string, extra: Partial<RegexSearchRequest> = {}): RegexSearchRequest => ({ segments: [{ text, from: 0 }], pattern, caseSensitive: true, ...extra });

describe('bounded native regex matching', () => {
  it('maps Unicode native lookaround/captures over independent editor text runs', () => {
    const result = collectRegexMatches(request('', '(?<=x)(?<value>😀|A)(?=!)', { segments: [{ text: 'x😀! xA!', from: 10 }, { text: 'x😀!', from: 50 }] }));
    expect([...result.ranges]).toEqual([11, 13, 16, 17, 51, 53]);
    expect(result.replacements).toBeUndefined();
  });

  it('uses multiline anchors for CodeMirror and Unicode progress for zero-width matches', () => {
    expect([...collectRegexMatches(request('a\nb', '^.', { multiline: true })).ranges]).toEqual([0, 1, 2, 3]);
    expect([...collectRegexMatches(request('😀x', '(?=.)')).ranges]).toEqual([0, 0, 2, 2]);
    expect([...collectRegexMatches(request(' \t a', '\\s+|a|(?=a)', { ignoreWhitespace: true })).ranges]).toEqual([3, 4]);
  });

  it('expands CodeMirror capture replacement in the worker while PM replacement stays literal', () => {
    const replacement = { text: '$2-$1-$12-$$-$&\\n', syntax: 'codemirror' as const };
    expect(collectRegexMatches(request('ab', '(a)(b)', { replacement })).replacements).toEqual(['b-a-a2-$-ab\n']);
    expect(collectRegexMatches(request('ab', '(a)(b)', { replacement: { ...replacement, syntax: 'literal' } })).replacements).toEqual([replacement.text]);
    expect(collectRegexMatches(request('a', '(a)', { replacement: { text: '$' + '0'.repeat(1_000) + '12', syntax: 'codemirror' } })).replacements).toEqual(['a2']);
  });

  it('admits large compact indexes but rejects overflow without returning a partial replace plan', () => {
    const text = 'x'.repeat(REGEX_SEARCH_LIMITS.matches);
    const admitted = collectRegexMatches(request(text, 'x'));
    expect(admitted.ranges.length).toBe(REGEX_SEARCH_LIMITS.matches * 2);
    expect(admitted.ranges.byteLength).toBe(REGEX_SEARCH_LIMITS.matches * 8);
    const refused = collectRegexMatches(request(text + 'x', 'x', { replacement: { text: 'y', syntax: 'literal' } }));
    expect(refused).toMatchObject({ limited: 'results' }); expect(refused.ranges.length).toBe(0); expect(refused.replacements).toBeUndefined();
  });

  it('rejects invalid patterns, input, unmappable offsets, and replacement amplification', () => {
    expect(collectRegexMatches(request('x', '[')).limited).toBe('pattern');
    expect(collectRegexMatches(request('', 'x'.repeat(REGEX_SEARCH_LIMITS.patternCharacters + 1))).limited).toBe('pattern');
    expect(collectRegexMatches(request('', 'x', { segments: [{ text: 'x', from: 0xffff_ffff }] })).limited).toBe('input');
    const text = 'a'.repeat(1024 * 1024);
    expect(collectRegexMatches(request('', 'a', { segments: Array.from({ length: 17 }, (_, index) => ({ text, from: index * text.length })) })).limited).toBe('input');
    expect(collectRegexMatches(request(text, 'a+', { replacement: { text: '$&'.repeat(5), syntax: 'codemirror' } })).limited).toBe('replacement');
  });
});

class TestRegexWorker {
  static instances: TestRegexWorker[] = [];
  onmessage?: (event: MessageEvent<RegexSearchResult>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminated = false;
  constructor() { TestRegexWorker.instances.push(this); }
  postMessage(_request: RegexSearchRequest) {}
  terminate() { this.terminated = true; }
  reply(result: RegexSearchResult) { this.onmessage?.({ data: result } as MessageEvent<RegexSearchResult>); }
}

describe('regex worker lifetime', () => {
  beforeEach(() => { vi.useFakeTimers(); TestRegexWorker.instances = []; vi.stubGlobal('Worker', TestRegexWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('terminates the entire timed-out calculation and allows a fresh query', async () => {
    const stalled = searchRegex(request('a'.repeat(32) + '!', '(a+)+$'));
    await vi.advanceTimersByTimeAsync(REGEX_SEARCH_LIMITS.workerMilliseconds);
    expect(await stalled).toMatchObject({ limited: 'time' }); expect(TestRegexWorker.instances[0].terminated).toBe(true);
    const next = searchRegex(request('abc', 'b')); const worker = TestRegexWorker.instances[1];
    worker.reply({ ranges: new Uint32Array([1, 2]) });
    expect([...(await next).ranges]).toEqual([1, 2]); expect(worker.terminated).toBe(true);
  });

  it('isolates cancellation and discards a late result from the cancelled snapshot', async () => {
    const controller = new AbortController();
    const cancelled = searchRegex(request('old', 'o'), { signal: controller.signal }).catch(error => error);
    const remaining = searchRegex(request('new', 'n'));
    controller.abort(); expect((await cancelled).name).toBe('AbortError');
    const [oldWorker, currentWorker] = TestRegexWorker.instances;
    expect(oldWorker.terminated).toBe(true); expect(currentWorker.terminated).toBe(false);
    oldWorker.reply({ ranges: new Uint32Array([0, 1]) }); currentWorker.reply({ ranges: new Uint32Array([1, 2]) });
    expect([...(await remaining).ranges]).toEqual([1, 2]); expect(vi.getTimerCount()).toBe(0);
  });

  it('never executes a main-thread regex fallback when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await searchRegex(request('a'.repeat(32) + '!', '(a+)+$'))).toMatchObject({ limited: 'unavailable' });
    expect(TestRegexWorker.instances).toHaveLength(0);
  });
});
