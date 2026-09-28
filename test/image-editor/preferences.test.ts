import { describe, expect, it, vi } from 'vitest';
import type { ImageEditorPreferences } from '../../src/core/ipc/types';
import { ImagePreferenceSession } from '../../src/features/image-editor/preferences';
import { createToolOperation, DEFAULT_TOOL_STYLE } from '../../src/features/image-editor/toolDefaults';

function fixture() {
  let settings: ImageEditorPreferences = { tools: { pen: { width: 7 }, marker: { markerSize: 72 } } };
  const write = vi.fn(async (patch: ImageEditorPreferences) => {
    const tools = { ...settings.tools };
    for (const [tool, fields] of Object.entries(patch.tools ?? {})) Object.assign(tools, { [tool]: { ...tools[tool as keyof typeof tools], ...fields } });
    settings = { ...settings, ...patch, tools };
  });
  const failed = vi.fn();
  return { session: new ImagePreferenceSession(() => settings, write, failed), write, failed, remote: (value: ImageEditorPreferences) => { settings = value; }, read: () => settings };
}

describe('image tool preference sessions', () => {
  it('coalesces a whole parameter gesture and writes only changed fields', async () => {
    const { session, write } = fixture();
    expect(session.style('marker').markerSize).toBe(72);
    session.begin();
    for (let width = 8; width <= 100; width++) { session.remember('pen', { width }); session.flush(); }
    expect(write).not.toHaveBeenCalled();
    session.end();
    expect(write).toHaveBeenCalledExactlyOnceWith({ tools: { pen: { width: 100 } } });
    session.end(); expect(write).toHaveBeenCalledTimes(1);
  });
  it('does not carry text, geometry or another tool into defaults', () => {
    const { session, write } = fixture();
    session.remember('text', { fontSize: 40, text: 'private annotation', markerSize: 200 }); session.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith({ tools: { text: { fontSize: 40 } } });
    expect(session.style('text').text).toBe('');
    expect(session.style('marker').markerSize).toBe(72);
    expect(session.style('eraser').width).toBe(20);
  });
  it('keeps local pending fields while adopting other remote defaults at tool entry', () => {
    const { session, write, remote } = fixture();
    const activeStyle = session.style('pen');
    session.begin(); session.remember('pen', { width: 12 });
    remote({ tools: { pen: { width: 9, color: '#22c55e' }, marker: { markerSize: 90 } } });
    expect(activeStyle.width).toBe(7);
    expect(session.style('pen')).toMatchObject({ width: 12, color: '#22c55e' });
    expect(session.style('marker').markerSize).toBe(90);
    session.end();
    expect(write).toHaveBeenCalledExactlyOnceWith({ tools: { pen: { width: 12 } } });
  });
  it('remembers an explicitly resized marker without copying its number or position', () => {
    const { session, write } = fixture();
    const before = createToolOperation('marker', { x: 10, y: 20 }, DEFAULT_TOOL_STYLE, 9)!;
    if (before.type !== 'marker') throw new Error('expected marker');
    session.rememberOperation(before, { ...before, center: { x: 500, y: 600 }, size: 100, value: 25 }); session.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith({ tools: { marker: { markerSize: 100 } } });
    session.rememberOperation(before, { ...before, center: { x: 30, y: 40 } }); session.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('bounds resize-derived defaults and reports failed writes without retry loops', async () => {
    const failed = vi.fn(), write = vi.fn().mockRejectedValue(new Error('disk full'));
    const session = new ImagePreferenceSession(() => ({}), write, failed);
    session.remember('marker', { markerSize: 20000, width: .2 }); session.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith({ tools: { marker: { markerSize: 2000, width: 1 } } });
    await Promise.resolve(); expect(failed).toHaveBeenCalledOnce();
    session.flush(); expect(write).toHaveBeenCalledOnce();
  });
});
