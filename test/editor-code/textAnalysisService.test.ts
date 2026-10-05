import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { handleExpandJson, handleMinifyJson } from '../../src/features/editor-code/jsonOps';
import { lintTextLanguage } from '../../src/features/editor-code/lint';
import { textAnalysisLifecycle } from '../../src/features/editor-code/textAnalysisLifecycle';
import { AnalysisCancelled, TextAnalysisService, textAnalysisService, type AnalysisWorker } from '../../src/features/editor-code/textAnalysisService';
import type { TextAnalysisRequest, TextAnalysisResult } from '../../src/features/editor-code/textAnalysis';
import { useToastStore } from '../../src/stores/toastStore';

class ControlledWorker implements AnalysisWorker {
  static instances: ControlledWorker[] = [];
  onmessage: AnalysisWorker['onmessage'] = null;
  onerror: AnalysisWorker['onerror'] = null;
  messages: { id: number; request: TextAnalysisRequest }[] = [];
  terminated = false;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(message: { id: number; request: TextAnalysisRequest }): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  complete(result: TextAnalysisResult): void {
    this.onmessage?.(new MessageEvent('message', { data: { id: this.messages.at(-1)!.id, result } }));
  }
}
const request: TextAnalysisRequest = { language: 'json', operation: 'validate', text: '{}' };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const views: EditorView[] = [];
const services: TextAnalysisService[] = [];
afterEach(() => {
  views.splice(0).forEach(view => view.destroy());
  services.splice(0).forEach(service => service.dispose());
  textAnalysisService.dispose();
  ControlledWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useToastStore.setState({ toasts: [] });
});

describe('bounded worker scheduling', () => {
  it('只有 active 消息和 latest 请求，淘汰过时请求并在 idle 释放 Worker', async () => {
    const service = new TextAnalysisService(() => new ControlledWorker());
    services.push(service);
    const first = service.request({}, request);
    const evicted = service.request({}, { ...request, text: '[]' }).catch(error => error);
    const latest = service.request({}, { ...request, text: '1' });
    const worker = ControlledWorker.instances[0];
    expect(worker.messages).toHaveLength(1);
    expect(await evicted).toBeInstanceOf(AnalysisCancelled);
    worker.complete({ validation: { valid: true } });
    await first;
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1].request.text).toBe('1');
    worker.complete({ validation: { valid: true } });
    await latest;
    expect(worker.terminated).toBe(true);
  });

  it('取消只影响对应 owner，并终止其 active Worker', async () => {
    const service = new TextAnalysisService(() => new ControlledWorker());
    services.push(service);
    const owner = {};
    const canceled = service.request(owner, request).catch(error => error);
    const other = service.request({}, request);
    service.cancelOwner(owner);
    expect(await canceled).toBeInstanceOf(AnalysisCancelled);
    expect(ControlledWorker.instances[0].terminated).toBe(true);
    ControlledWorker.instances[1].complete({ validation: { valid: true } });
    expect((await other).validation?.valid).toBe(true);
  });

  it('自动任务不会淘汰排队的手动操作', async () => {
    const service = new TextAnalysisService(() => new ControlledWorker());
    services.push(service);
    const active = service.request({}, request);
    const manual = service.request({}, request);
    const automatic = service.request({}, request, 'automatic').catch(error => error);
    expect(await automatic).toBeInstanceOf(AnalysisCancelled);
    ControlledWorker.instances[0].complete({ validation: { valid: true } });
    await active;
    ControlledWorker.instances[0].complete({ validation: { valid: true } });
    expect((await manual).validation?.valid).toBe(true);
  });

  it('active 超时后释放 Worker 并继续其他 owner 的 latest 请求', async () => {
    vi.useFakeTimers();
    const service = new TextAnalysisService(() => new ControlledWorker());
    services.push(service);
    const timeout = service.request({}, request).catch(error => error);
    const latest = service.request({}, request);
    vi.advanceTimersByTime(30000);
    expect((await timeout).message).toContain('超时');
    expect(ControlledWorker.instances[0].terminated).toBe(true);
    ControlledWorker.instances[1].complete({ validation: { valid: true } });
    expect((await latest).validation?.valid).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('已终止 Worker 的迟到错误不会误终止新任务', async () => {
    const service = new TextAnalysisService(() => new ControlledWorker());
    services.push(service);
    const owner = {};
    const canceled = service.request(owner, request).catch(error => error);
    const lateError = ControlledWorker.instances[0].onerror;
    const latest = service.request({}, request);
    service.cancelOwner(owner);
    await canceled;
    lateError?.(new ErrorEvent('error', { message: 'late' }));
    const worker = ControlledWorker.instances[1];
    expect(worker.terminated).toBe(false);
    worker.complete({ validation: { valid: true } });
    expect((await latest).validation?.valid).toBe(true);
  });
});

describe('editor asynchronous safety', () => {
  function createView() {
    vi.stubGlobal('Worker', ControlledWorker);
    const view = new EditorView({ state: EditorState.create({ doc: '{"padding":"' + 'x'.repeat(40 * 1024) + '"}', extensions: [textAnalysisLifecycle] }) });
    views.push(view);
    return view;
  }

  it('后台操作成功应用，保留同步 boolean handler 接口', async () => {
    const view = createView();
    expect(handleMinifyJson(view)).toBe(true);
    const worker = ControlledWorker.instances[0];
    worker.complete({ output: '{"n":9007199254740993}' });
    await flush();
    expect(view.state.doc.toString()).toBe('{"n":9007199254740993}');
    expect(worker.terminated).toBe(true);
  });

  it.each(['document', 'selection', 'destroy'] as const)('%s 变化会取消任务，晚到结果不能覆盖', async change => {
    const view = createView();
    expect(handleExpandJson(view)).toBe(true);
    const worker = ControlledWorker.instances[0];
    const lateMessage = worker.onmessage;
    if (change === 'document') view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'new text' } });
    else if (change === 'selection') view.dispatch({ selection: { anchor: 5 } });
    else view.destroy();
    expect(worker.terminated).toBe(true);
    lateMessage?.(new MessageEvent('message', { data: { id: worker.messages[0].id, result: { output: 'old result' } } }));
    await flush();
    expect(view.state.doc.toString()).not.toContain('old result');
    if (change === 'destroy') expect(useToastStore.getState().toasts.some(toast => toast.message.includes('操作已取消'))).toBe(false);
  });

  it('初始自动 lint 不取消已经运行的手动操作', async () => {
    const view = createView();
    handleExpandJson(view);
    const worker = ControlledWorker.instances[0];
    const lint = lintTextLanguage(view, 'json');
    expect(worker.terminated).toBe(false);
    worker.complete({ output: '{"valid":true}' });
    await flush();
    expect(view.state.doc.toString()).toContain('"valid":true');
    expect(await lint).toEqual([]);
  });

  it('很小但极深的 JSON 展开同样进入 Worker', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const view = new EditorView({ state: EditorState.create({ doc: '['.repeat(100) + '1' + ']'.repeat(100), extensions: [textAnalysisLifecycle] }) });
    views.push(view);
    expect(handleExpandJson(view)).toBe(true);
    expect(ControlledWorker.instances).toHaveLength(1);
  });
});
