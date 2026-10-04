// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { FigureCaptionTransition } from '../../src/features/editor-md/figureCaptionTransition';
import { showToast } from '../../src/stores/toastStore';
import { getEditingScope } from '../../src/features/editor-md/editingScope';

vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
type CaptionEditorModule = typeof import('../../src/features/editor-md/figureCaptionEditor');
function deferred() {
  let resolve!: (value: CaptionEditorModule) => void, reject!: (reason: Error) => void;
  const promise = new Promise<CaptionEditorModule>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
const transitions: FigureCaptionTransition[] = [];
function setup(view = { editable: true, isDestroyed: false, dom: document.createElement('div') } as unknown as EditorView) {
  const preview = document.createElement('span'), host = document.createElement('div'), outside = document.createElement('button');
  preview.textContent = 'Results\nSecond line'; preview.tabIndex = 0; host.hidden = true;
  document.body.append(preview, host, outside); preview.focus();
  const pending = deferred(), load = vi.fn(() => pending.promise), onEditingChange = vi.fn();
  const focus = vi.fn(() => host.querySelector<HTMLElement>('[contenteditable]')!.focus());
  const mountFigureCaptionEditor = vi.fn(() => {
    expect(preview.hidden).toBe(false); expect(host.hidden).toBe(true);
    const input = document.createElement('div'); input.contentEditable = 'true'; input.tabIndex = 0; input.textContent = preview.textContent;
    input.setAttribute('contenteditable', 'true'); host.replaceChildren(input);
    return { editor: {} as Editor, sync: vi.fn(), focus, destroy: vi.fn() };
  });
  const module = { mountFigureCaptionEditor } as CaptionEditorModule;
  const transition = new FigureCaptionTransition(preview, host, { view, getPos: () => 0, label: '表注', onEditingChange }, load);
  transitions.push(transition);
  return { transition, preview, host, outside, pending, load, module, mountFigureCaptionEditor, focus, onEditingChange, view };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
afterEach(() => { transitions.splice(0).forEach(transition => transition.destroy()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe('caption editing transitions', () => {
  it('keeps the rendered caption and focus until a populated editor is ready', async () => {
    const current = setup();
    current.transition.begin(); current.transition.begin();
    expect(current.load).toHaveBeenCalledTimes(1);
    expect(current.preview.hidden).toBe(false); expect(current.preview.textContent).toBe('Results\nSecond line');
    expect(current.host.hidden).toBe(true); expect(document.activeElement).toBe(current.preview);
    expect(current.onEditingChange).not.toHaveBeenCalled();
    current.pending.resolve(current.module); await settle();
    expect(current.preview.hidden).toBe(true); expect(current.host.hidden).toBe(false);
    expect(current.host.textContent).toBe('Results\nSecond line');
    expect(document.activeElement).toBe(current.host.firstChild);
    expect(current.onEditingChange).toHaveBeenLastCalledWith(true);
  });

  it('blocks body commands during lazy loading and keeps the request through toolbar or portal interaction', async () => {
    const current = setup(); current.transition.begin();
    expect(getEditingScope(current.view)?.kind).toBe('external');
    for (const className of ['responsive-toolbar', 'nb-highlight-menu']) {
      const control = document.body.appendChild(document.createElement('button')); control.className = className;
      control.dispatchEvent(new Event('pointerdown', { bubbles: true })); control.focus();
      expect(getEditingScope(current.view)?.kind).toBe('external');
    }
    current.pending.resolve(current.module); await settle();
    expect(current.mountFigureCaptionEditor).toHaveBeenCalledTimes(1);
    expect(current.host.hidden).toBe(false);
    // The real mounted caption replaces this temporary scope. This fixture has
    // no editor registration, so settling also proves the loading guard releases.
    expect(getEditingScope(current.view)).toBeNull();
  });

  it.each(['pointer', 'focus', 'Escape', 'Tab', 'blur', 'destroy'] as const)('does not steal focus when loading finishes after %s cancellation', async action => {
    const current = setup(); current.transition.begin();
    if (action === 'pointer') current.outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    else if (action === 'focus') current.outside.focus();
    else if (action === 'blur') window.dispatchEvent(new Event('blur'));
    else if (action === 'destroy') current.transition.destroy();
    else current.preview.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true }));
    const active = document.activeElement;
    current.pending.resolve(current.module); await settle();
    expect(current.mountFigureCaptionEditor).not.toHaveBeenCalled();
    expect(getEditingScope(current.view)).toBeNull();
    expect(current.preview.hidden).toBe(false); expect(current.host.hidden).toBe(true);
    expect(document.activeElement).toBe(active);
  });

  it('preserves the caption after a failed load and permits retry', async () => {
    const current = setup(); current.transition.begin();
    current.pending.reject(new Error('chunk unavailable')); await settle();
    expect(current.preview.hidden).toBe(false); expect(current.preview.textContent).toContain('Results');
    expect(current.host.hidden).toBe(true); expect(showToast).toHaveBeenCalledWith('表注编辑器加载失败，请重试', 'error');
    current.load.mockResolvedValueOnce(current.module);
    current.transition.begin(); await settle();
    expect(current.mountFigureCaptionEditor).toHaveBeenCalledTimes(1); expect(current.host.hidden).toBe(false);
  });

  it('clears a partially mounted editor after failure and permits retry', async () => {
    const current = setup();
    current.mountFigureCaptionEditor.mockImplementationOnce(() => { current.host.textContent = 'partial'; throw new Error('mount failed'); });
    current.transition.begin(); current.pending.resolve(current.module); await settle();
    expect(current.preview.hidden).toBe(false); expect(current.host.hidden).toBe(true); expect(current.host.childNodes).toHaveLength(0);
    current.transition.begin(); await settle();
    expect(current.host.hidden).toBe(false); expect(current.focus).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale failure after a newer request succeeds', async () => {
    const current = setup(); current.transition.begin();
    current.outside.focus(); current.preview.focus();
    current.load.mockResolvedValueOnce(current.module); current.transition.begin(); await settle();
    current.pending.reject(new Error('old request failed')); await settle();
    expect(current.host.hidden).toBe(false); expect(current.preview.hidden).toBe(true);
    expect(showToast).not.toHaveBeenCalled(); expect(document.activeElement).toBe(current.host.firstChild);
  });

  it('only opens the latest caption requested in the same document', async () => {
    const first = setup(), second = setup(first.view);
    first.transition.begin(); second.transition.begin();
    first.pending.resolve(first.module); second.pending.resolve(second.module); await settle();
    expect(first.mountFigureCaptionEditor).not.toHaveBeenCalled();
    expect(second.mountFigureCaptionEditor).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(second.host.firstChild);
  });
});
