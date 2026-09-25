import { Node } from '@tiptap/core';

/** Opaque recovery node: editing nearby content never discards the bad record. */
export const NativeError = Node.create({
  name: 'nativeError', group: 'block', atom: true, selectable: true, isolating: true,
  addAttributes() { return { raw: { default: '' }, message: { default: '无法解析此内容。' }, line: { default: null } }; },
  parseHTML() { return [{ tag: 'pre[data-native-error]' }]; },
  renderHTML({ node }) { return ['pre', { 'data-native-error': '', class: 'nb-native-error', 'aria-label': node.attrs.message }, String(node.attrs.raw)]; },
  renderMarkdown(node) { return `\n\n\`\`\`noteboard-error\n${String(node.attrs?.raw ?? '')}\n\`\`\`\n\n`; },
});
