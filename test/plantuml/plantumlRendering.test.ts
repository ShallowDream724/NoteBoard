import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPlantUmlCache, PLANTUML_SOURCE_BYTES, PLANTUML_SVG_BYTES, renderPlantUmlToSvg } from '@/features/plantuml/plantumlEncoder';
import { sanitizePlantUmlSvg } from '@/features/plantuml/plantumlSvg';
import { renderExportDiagrams } from '@/features/export/renderDiagrams';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M1 1L90 30" fill="none" style="stroke:#333;stroke-width:2"/><text x="5" y="20">Alice → Bob</text></svg>';
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { clearPlantUmlCache(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { clearPlantUmlCache(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('PlantUML network and SVG boundary', () => {
  it('never uploads on default rendering or uncached export and reuses only authorized sanitized results', async () => {
    expect((await renderPlantUmlToSvg('Alice -> Bob')).permissionRequired).toBe(true);
    const offline = await renderExportDiagrams([{ kind: 'plantuml', code: 'Alice -> Bob' }]);
    expect(offline[0].error).toContain('未缓存'); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(svg));
    expect((await renderPlantUmlToSvg('Alice -> Bob', undefined, { allowNetwork: true })).svg).toContain('Alice');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\//);
    const cached = await renderExportDiagrams([{ kind: 'plantuml', code: 'Alice -> Bob' }]);
    expect(cached[0].html).toContain('Alice'); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('removes active SVG, external links/references and CSS fetches while retaining diagram strokes and local references', () => {
    const cleaned = sanitizePlantUmlSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><style>@import url(https://evil.test)</style><defs><path id="shape" d="M0 0L2 2"/></defs><use href="#shape"/><use xlink:href="https://evil.test/image.svg#x"/><image href="data:image/svg+xml,unsafe"/><a href="https://evil.test"><text>label</text></a><animate attributeName="href" values="https://evil.test"/><rect fill="url(https://evil.test/a)" style="stroke:#333;stroke-width:2;fill:var(--remote);background-image:url(https://evil.test);cursor:url(https://evil.test),auto"/><path style="stroke:#456;stroke-width:1" marker-end="url(#shape)"/></svg>`);
    const host = document.createElement('div'); host.innerHTML = cleaned;
    expect(host.querySelector('script,foreignObject,style,a,animate')).toBeNull();
    expect(cleaned).not.toContain('evil.test'); expect(cleaned).not.toContain('onload'); expect(cleaned).not.toContain('data:image');
    expect(host.querySelector('use')?.getAttribute('href')).toBe('#shape');
    expect(host.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe('url(#shape)');
    expect(host.querySelector('rect')?.getAttribute('fill')).toBeNull();
    expect(host.querySelector('path[marker-end]')?.getAttribute('style')).toContain('stroke');
    expect(host.textContent).toContain('label');
  });
  it('sanitizes before putting results in the cache and rejects malformed output', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>evil()</script><text>safe</text></svg>'));
    const result = await renderPlantUmlToSvg('test', undefined, { allowNetwork: true });
    expect(result.svg).not.toContain('evil'); result.svg = 'poisoned';
    expect((await renderPlantUmlToSvg('test')).svg).toContain('safe');
    fetchMock.mockResolvedValueOnce(new Response('<html><body>Not SVG</body></html>'));
    expect((await renderPlantUmlToSvg('invalid', undefined, { allowNetwork: true })).error).toContain('无效');
  });
  it('rejects oversized UTF-8 source before encoding or requesting and oversized response before caching', async () => {
    expect((await renderPlantUmlToSvg('中'.repeat(PLANTUML_SOURCE_BYTES / 3 + 1), undefined, { allowNetwork: true })).error).toContain('128 KiB');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(svg, { headers: { 'content-length': String(PLANTUML_SVG_BYTES + 1) } }));
    expect((await renderPlantUmlToSvg('oversized', undefined, { allowNetwork: true })).error).toContain('2 MiB');
    expect((await renderPlantUmlToSvg('oversized')).permissionRequired).toBe(true);
  });
  it('bounds streamed output without trusting content-length and cancels the stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(PLANTUML_SVG_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel });
    fetchMock.mockResolvedValueOnce(new Response(body));
    expect((await renderPlantUmlToSvg('stream-limit', undefined, { allowNetwork: true })).error).toContain('2 MiB');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not cache HTTP/network/syntax failures, allowing a corrected service retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>Syntax Error?</text></svg>')).mockResolvedValueOnce(new Response(svg));
    for (let index = 0; index < 3; index++) expect((await renderPlantUmlToSvg('retry', undefined, { allowNetwork: true })).error).toBeTruthy();
    expect((await renderPlantUmlToSvg('retry', undefined, { allowNetwork: true })).error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('cancels pending reads and times out requests while preserving caller cancellation', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const pending = renderPlantUmlToSvg('timeout', undefined, { allowNetwork: true });
    await vi.advanceTimersByTimeAsync(20001);
    expect((await pending).error).toContain('超时'); expect(cancel).toHaveBeenCalledOnce();
    const controller = new AbortController(); controller.abort(new Error('view closed'));
    await expect(renderPlantUmlToSvg('cancelled', controller.signal, { allowNetwork: true })).rejects.toThrow('view closed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('evicts least recent SVGs by estimated bytes instead of retaining unlimited large strings', async () => {
    const large = '<svg xmlns="http://www.w3.org/2000/svg"><text>' + 'x'.repeat(900 * 1024) + '</text></svg>';
    fetchMock.mockImplementation(async () => new Response(large));
    for (let index = 0; index < 5; index++) await renderPlantUmlToSvg('diagram-' + index, undefined, { allowNetwork: true });
    expect((await renderPlantUmlToSvg('diagram-0')).permissionRequired).toBe(true);
    expect((await renderPlantUmlToSvg('diagram-4')).svg).toContain('<svg');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
