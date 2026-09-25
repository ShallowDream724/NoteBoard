// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ImageNode } from '../../src/features/editor-md/documentNodes';
import { InteractiveImageCollection, InteractiveImageSlot } from '../../src/features/editor-md/rich-content/views';

const editors: Editor[] = [];
function create() {
  const editor = new Editor({ extensions: [StarterKit, ImageNode, InteractiveImageCollection, InteractiveImageSlot], content: {
    type: 'doc', content: [{ type: 'imageCollection', attrs: { layout: 'carousel' }, content: Array.from({ length: 5 }, (_, index) => ({
      type: 'imageSlot', content: [{ type: 'image', attrs: { src: `picture-${index}.png`, alt: `Accessible ${index}` } }, { type: 'paragraph', content: [{ type: 'text', text: `Caption ${index}` }] }],
    })) }],
  } });
  document.body.append(editor.view.dom); editors.push(editor);
  const viewport = editor.view.dom.querySelector<HTMLElement>('.nb-image-viewport')!;
  Object.defineProperty(viewport, 'clientWidth', { value: 800, configurable: true });
  const scrollTo = vi.fn(); viewport.scrollTo = scrollTo;
  const button = (label: string) => editor.view.dom.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { editor, viewport, scrollTo, button };
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('carousel navigation', () => {
  it('retargets repeated next/previous without removing slides or editing the document', async () => {
    const { editor, viewport, scrollTo, button } = create();
    await new Promise(requestAnimationFrame);
    const before = editor.state.doc, slides = [...viewport.querySelectorAll('.nb-image-slot')];
    button('下一张图片').click(); button('下一张图片').click();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1600, behavior: 'smooth' });
    viewport.scrollLeft = 300; viewport.dispatchEvent(new Event('scroll'));
    await new Promise(requestAnimationFrame);
    expect(button('第 3 张图片').getAttribute('aria-pressed')).toBe('true');
    button('上一张图片').click();
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 800, behavior: 'smooth' });
    expect([...viewport.querySelectorAll('.nb-image-slot')]).toEqual(slides);
    expect(editor.state.doc).toBe(before);
  });
  it('follows horizontal wheel position and keeps only neighbouring image slots warm', async () => {
    const { viewport, button } = create(); await new Promise(requestAnimationFrame);
    button('下一张图片').click();
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 1 }));
    viewport.scrollLeft = 2400; viewport.dispatchEvent(new Event('scroll'));
    await new Promise(requestAnimationFrame);
    expect(button('第 4 张图片').getAttribute('aria-pressed')).toBe('true');
    expect([...viewport.querySelectorAll('[data-carousel-nearby]')].map(node => node.querySelector('p')?.textContent)).toEqual(['Caption 2', 'Caption 3', 'Caption 4']);
  });
  it('uses immediate native scrolling for reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const { scrollTo, button } = create(); await new Promise(requestAnimationFrame);
    button('下一张图片').click(); expect(scrollTo).toHaveBeenLastCalledWith({ left: 800, behavior: 'auto' });
    vi.unstubAllGlobals();
  });
});
