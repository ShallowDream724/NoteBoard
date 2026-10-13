// NoteBoard PlantUML 编码与渲染工具
// 官方编码、明确授权的在线渲染、安全 SVG 与有界内存缓存
// 详见 docs/09-开发路线图.md

import plantumlEncoder from 'plantuml-encoder';
import { sanitizePlantUmlSvg } from './plantumlSvg';

/** LRU 内存缓存 */
class SvgCache {
  private bytes = 0;
  private map = new Map<string, { svg: string; bytes: number }>();
  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value?.svg;
  }
  set(key: string, svg: string): void {
    const bytes = 128 + (key.length + svg.length) * 2;
    if (bytes > PLANTUML_CACHE_BYTES) return;
    const previous = this.map.get(key);
    if (previous) { this.bytes -= previous.bytes; this.map.delete(key); }
    while (this.bytes + bytes > PLANTUML_CACHE_BYTES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.map.get(oldest)!.bytes; this.map.delete(oldest);
    }
    this.map.set(key, { svg, bytes }); this.bytes += bytes;
  }
  clear(): void { this.map.clear(); this.bytes = 0; }
}

/** PlantUML 官方公开服务根地址 */
const PLANTUML_SERVER_URL = 'https://www.plantuml.com/plantuml';

export const PLANTUML_SOURCE_BYTES = 128 * 1024;
export const PLANTUML_SVG_BYTES = 2 * 1024 * 1024;
export const PLANTUML_CACHE_BYTES = 8 * 1024 * 1024;
const plantUmlSvgCache = new SvgCache();
export interface PlantUmlRenderResult { svg: string; error?: string; permissionRequired?: boolean }
export interface PlantUmlRenderOptions { allowNetwork?: boolean }

async function readSvg(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > PLANTUML_SVG_BYTES) { await response.body?.cancel(); throw new Error('SVG 超过 2 MiB，无法预览。'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('渲染服务未返回 SVG 内容。');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > PLANTUML_SVG_BYTES) throw new Error('SVG 超过 2 MiB，无法预览。');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/**
 * 编码 PlantUML 文本为标准 URL 格式（支持中文 UTF-8 与全图表类型）
 */
export function compressAndEncodePlantUml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // 补全 @startuml ... @enduml
  let source = trimmed;
  if (
    !source.includes('@startuml') &&
    !source.includes('@startmindmap') &&
    !source.includes('@startsalt') &&
    !source.includes('@startwbs') &&
    !source.includes('@startgantt')
  ) {
    source = `@startuml\n${source}\n@enduml`;
  }

  try {
    return plantumlEncoder.encode(source);
  } catch {
    // 降级使用 PlantUML 官方支持的 HEX 编码 (~h 前缀)
    const utf8Encoder = new TextEncoder();
    const bytes = utf8Encoder.encode(source);
    let hex = '~h';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
}

/**
 * 获取 PlantUML 在线 SVG 地址
 */
export function getPlantUmlSvgUrl(code: string, serverUrl = PLANTUML_SERVER_URL): string {
  const encoded = compressAndEncodePlantUml(code);
  if (!encoded) return '';
  const baseUrl = serverUrl.replace(/\/+$/, '');
  return `${baseUrl}/svg/${encoded}`;
}

/** 别名导出 */
export const encodePlantUml = compressAndEncodePlantUml;

/**
 * 异步渲染 PlantUML 为 SVG 内容（带 LRU 缓存）
 */
export async function renderPlantUmlToSvg(code: string, signal?: AbortSignal, options: PlantUmlRenderOptions = {}): Promise<PlantUmlRenderResult> {
  signal?.throwIfAborted();
  const trimmed = code.trim();
  if (!trimmed) {
    return { svg: '' };
  }

  if (trimmed.length > PLANTUML_SOURCE_BYTES || new TextEncoder().encode(trimmed).byteLength > PLANTUML_SOURCE_BYTES) return { svg: '', error: 'PlantUML 源码超过 128 KiB，无法在线预览。' };
  const cached = plantUmlSvgCache.get(trimmed);
  if (cached) return { svg: cached };
  if (!options.allowNetwork) return { svg: '', permissionRequired: true, error: 'PlantUML 图形未缓存。请先在文档中启用在线预览，或保留图表源码导出。' };
  const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('PlantUML 渲染超时，请重试。')), 20000);
  try {
    const url = getPlantUmlSvgUrl(trimmed);
    if (!url) return { svg: '', error: '代码为空' };

    signal?.throwIfAborted();
    const resp = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!resp.ok) {
      await resp.body?.cancel();
      return { svg: '', error: `HTTP ${resp.status}: 渲染服务请求失败` };
    }
    const svgText = sanitizePlantUmlSvg(await readSvg(resp, controller.signal));
    controller.signal.throwIfAborted();
    // 检查是否包含 PlantUML 错误信息
    if (svgText.includes('Syntax Error?') || svgText.includes('[PlantUML error]') || svgText.includes('does not look like HUFFMAN data')) {
      return { svg: svgText, error: 'PlantUML 语法或格式错误' };
    }

    const okResult = { svg: svgText };
    if (new TextEncoder().encode(svgText).byteLength > PLANTUML_SVG_BYTES) return { svg: '', error: 'SVG 超过 2 MiB，无法预览。' };
    plantUmlSvgCache.set(trimmed, svgText);
    return okResult;
  } catch (err) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) return { svg: '', error: 'PlantUML 渲染超时，请重试。' };
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { svg: '', error: `无法连接 PlantUML 渲染服务器 (${errorMsg})` };
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); controller.abort(); }
}

/** 清理 PlantUML 缓存 */
export function clearPlantUmlCache(): void {
  plantUmlSvgCache.clear();
}
