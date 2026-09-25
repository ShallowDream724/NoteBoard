// Document grammar only: safe to use in workers, codecs and export projections.
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';

export const ANNOTATION_BLOCK_TYPES = [
  'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList',
  'codeBlock', 'horizontalRule', 'image', 'table', 'mathBlock', 'githubAlert',
  'mermaidBlock', 'plantumlBlock', 'infographicBlock', 'imageCollection', 'disclosure',
];

export const AnnotationReference = Mark.create({
  name: 'annotationReference', inclusive: false,
  addAttributes() { return { id: { default: null, parseHTML: element => element.getAttribute('data-annotation-id'), rendered: false } }; },
  parseHTML() { return [{ tag: 'span[data-annotation-id]' }]; },
  renderHTML({ mark }) { return ['span', { 'data-annotation-id': mark.attrs.id, class: 'nb-annotation-anchor', tabindex: '0', 'aria-label': '补充说明' }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node); },
});

export const AnnotationBody = Node.create({
  name: 'annotationBody', content: 'block+', defining: true, selectable: false,
  addAttributes() { return { id: { default: null, parseHTML: element => element.getAttribute('data-annotation-body'), rendered: false } }; },
  parseHTML() { return [{ tag: 'section[data-annotation-body]' }]; },
  renderHTML({ node }) { return ['section', { 'data-annotation-body': node.attrs.id }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n'); },
});

export const AnnotationStore = Node.create({
  name: 'annotationStore', group: 'block', content: 'annotationBody+', atom: true,
  isolating: true, selectable: false, draggable: false,
  parseHTML() { return [{ tag: 'aside[data-annotation-store]' }]; },
  renderHTML({ HTMLAttributes }) { return ['aside', mergeAttributes(HTMLAttributes, { 'data-annotation-store': '', 'aria-label': '补充说明' }), 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node.content ?? [], '\n\n'); },
});

export const AnnotationAnchors = Extension.create({
  name: 'annotationAnchors',
  addGlobalAttributes() { return [{ types: ANNOTATION_BLOCK_TYPES, attributes: {
    annotationId: { default: null, keepOnSplit: false, parseHTML: element => element.getAttribute('data-annotation-id'),
      renderHTML: attrs => attrs.annotationId ? { 'data-annotation-id': attrs.annotationId, class: 'nb-annotation-block-anchor' } : {} },
  } }]; },
});

export const annotationSchemaExtensions = [AnnotationReference, AnnotationBody, AnnotationStore, AnnotationAnchors];
