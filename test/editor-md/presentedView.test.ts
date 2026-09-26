import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { expect, it, vi } from 'vitest';
import { withRichPresentation } from '../../src/features/editor-md/rich-content/presentedView';

it('decorates a copied view without replaying inherited hooks or mutating the original', async () => {
  const registered = vi.fn(), created = vi.fn(), render = vi.fn();
  const key = new PluginKey('presented-view-test');
  const base = Node.create({
    name: 'presentedBlock', group: 'block', atom: true,
    addOptions() { return { label: 'original' }; },
    addAttributes() { return { concealed: { default: false } }; },
    renderHTML() { return ['div']; },
    addProseMirrorPlugins() { return []; },
    addNodeView() {
      return () => {
        render(); const dom = document.createElement('div'); dom.textContent = this.options.label;
        return { dom, update: () => true };
      };
    },
  });
  const original = base.extend({
    addProseMirrorPlugins() { registered(); return [...this.parent!(), new Plugin({ key })]; },
    onCreate() { created(); },
  }).configure({ label: 'configured' });
  const originalView = original.config.addNodeView;
  const decorated = withRichPresentation(original);
  const editor = new Editor({ extensions: [StarterKit, decorated],
    content: { type: 'doc', content: [{ type: 'presentedBlock', attrs: { concealed: true } }] } });
  try {
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(registered).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.textContent).toBe('configured');
    expect(editor.view.dom.querySelector('[data-nb-conceal]')?.getAttribute('tabindex')).toBe('0');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { concealed: false }));
    expect(editor.view.dom.querySelector('[data-nb-conceal]')).toBeNull();
    expect(editor.view.dom.firstElementChild?.hasAttribute('tabindex')).toBe(false);
    expect(original.config.addNodeView).toBe(originalView);
  } finally { editor.destroy(); }
});
