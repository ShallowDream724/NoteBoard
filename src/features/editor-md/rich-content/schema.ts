import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { collectionPresentation, isCollectionAlign, isCollectionWidth } from './collectionPresentation';

/** Public, hand-authorable grammar. Views and export policy live outside it. */
export const ImageCollection = Node.create({
  name: 'imageCollection', group: 'block', content: 'imageSlot+', defining: true, isolating: true,
  addAttributes() { return {
    layout: { default: 'grid', validate: value => { if (!['grid', 'carousel'].includes(value)) throw new RangeError('Invalid image layout'); } },
    columns: { default: 2, validate: value => { if (value !== 2 && value !== 3) throw new RangeError('Invalid image columns'); } },
    width: { default: '100%', validate: value => { if (!isCollectionWidth(value)) throw new RangeError('Invalid image collection width'); } },
    align: { default: 'center', validate: value => { if (!isCollectionAlign(value)) throw new RangeError('Invalid image collection alignment'); } },
  }; },
  parseHTML() { return [{ tag: 'section[data-nb-images]', getAttrs: element => {
    const width = element.getAttribute('data-width'), align = element.getAttribute('data-align');
    return { layout: element.getAttribute('data-nb-images') === 'carousel' ? 'carousel' : 'grid', columns: Number(element.getAttribute('data-columns')) === 3 ? 3 : 2,
      width: isCollectionWidth(width) ? width : '100%', align: isCollectionAlign(align) ? align : 'center' };
  } }]; },
  renderHTML({ node, HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-nb-images': node.attrs.layout, 'data-columns': node.attrs.columns,
    'data-width': node.attrs.width, 'data-align': node.attrs.align, style: collectionPresentation(node.attrs).style }), 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n'); },
});
export const ImageSlot = Node.create({
  name: 'imageSlot', content: 'image? paragraph?', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'figure[data-nb-image-slot]' }]; },
  renderHTML() { return ['figure', { 'data-nb-image-slot': '' }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n'); },
});
export const Disclosure = Node.create({
  name: 'disclosure', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes() { return { title: { default: '更多内容', validate: 'string' }, open: { default: true, validate: 'boolean' } }; },
  parseHTML() { return [{ tag: 'details', getAttrs: element => ({ title: element.querySelector(':scope > summary')?.textContent ?? '更多内容', open: element.hasAttribute('open') }), contentElement: element => {
    const body = element.querySelector(':scope > [data-nb-disclosure-body]');
    if (body) return body as HTMLElement;
    const copy = element.cloneNode(true) as HTMLElement; copy.querySelector(':scope > summary')?.remove(); return copy;
  } }]; },
  renderHTML({ node, HTMLAttributes }) { return ['details', mergeAttributes(HTMLAttributes, { 'data-nb-disclosure': '', open: node.attrs.open ? '' : null }), ['summary', {}, node.attrs.title], ['div', { 'data-nb-disclosure-body': '' }, 0]]; },
  renderMarkdown(node, helpers) { return `${String(node.attrs?.title ?? '')}\n\n${helpers.renderChildren(node.content ?? [], '\n\n')}`; },
});
export const Conceal = Mark.create({
  name: 'conceal', inclusive: true,
  parseHTML() { return [{ tag: 'span[data-nb-conceal]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-nb-conceal': '', tabindex: '0', 'aria-label': '聚焦以显示内容' }), 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node); },
});
export const ConcealedBlocks = Extension.create({
  name: 'concealedBlocks',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'image', 'imageCollection', 'disclosure', 'mathBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock', 'githubAlert'], attributes: {
    concealed: { default: false, validate: 'boolean', parseHTML: element => element.hasAttribute('data-nb-conceal'), renderHTML: attrs => attrs.concealed ? { 'data-nb-conceal': '', tabindex: '0', 'aria-label': '聚焦以显示内容' } : {} },
  } }]; },
});
export const richContentGrammar = [ImageCollection, ImageSlot, Disclosure, Conceal, ConcealedBlocks];
