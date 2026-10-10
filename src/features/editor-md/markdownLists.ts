import { OrderedList, TaskList } from '@tiptap/extension-list';
import { mergeAttributes } from '@tiptap/core';
import { normalizeNumberingStyle } from './numbering/styles';

const ordered = OrderedList.config.markdownTokenizer!;
const task = TaskList.config.markdownTokenizer!;
const parseOrdered: NonNullable<typeof OrderedList.config.parseMarkdown> = (token, helpers) => {
  const parsed = OrderedList.config.parseMarkdown!(token, helpers);
  // Upstream's ordered parser bypasses ListItem and emits [] for an empty row.
  // Restore its required first paragraph while preserving the actual empty item.
  for (const list of Array.isArray(parsed) ? parsed : parsed ? [parsed] : []) {
    for (const item of list.content ?? []) if (item.type === 'listItem' && !item.content?.length) item.content = [{ type: 'paragraph' }];
  }
  return parsed;
};

// Upstream list tokenizers split their entire remaining source before checking
// its first line. Reject impossible prefixes before entering that allocation.
// These guards are deliberately permissive; upstream retains grammar authority.
export const MarkdownOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      numberStyle: { default: null,
        parseHTML: element => element.hasAttribute('data-number-style') ? normalizeNumberingStyle(element.getAttribute('data-number-style')) : null,
        renderHTML: attrs => attrs.numberStyle ? { 'data-number-style': normalizeNumberingStyle(attrs.numberStyle) } : {},
      },
      numbering: { default: null,
        parseHTML: element => ['continue', 'restart'].includes(element.getAttribute('data-numbering') ?? '') ? element.getAttribute('data-numbering') : null,
        renderHTML: attrs => ['continue', 'restart'].includes(attrs.numbering) ? { 'data-numbering': attrs.numbering } : {},
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const start = Number(node.attrs.start) || 1;
    // An intrinsic marker column grows with its children without a NodeView,
    // observer or renderHTML refresh when Enter crosses a digit boundary.
    return this.parent!({ node, HTMLAttributes: mergeAttributes(HTMLAttributes, {
      'data-numbering-layout': 'columns', style: `counter-reset: list-item ${start - 1}`,
    }) });
  },
  renderMarkdown(node, helpers, context) {
    const content = OrderedList.config.renderMarkdown!(node, helpers, context);
    // Blank lines alone merge adjacent ordered lists in CommonMark. A standard
    // comment retains explicit segment boundaries without visible content.
    return context.previousNode?.type === 'orderedList' ? `${context.parentType === 'listItem' ? '\n' : ''}<!-- noteboard-list-boundary -->\n\n${content}` : content;
  },
  parseMarkdown(token, helpers) {
    if (!token.ordered || !token.items?.length || !token.raw?.includes('<!-- noteboard-list-boundary -->')) return parseOrdered(token, helpers);
    // The upstream tokenizer deliberately accepts two-space nested lists, but
    // folds their same-indent HTML boundary into the preceding item's raw text.
    const groups: typeof token.items[] = []; let group: typeof token.items = [];
    for (const item of token.items) {
      group.push(item);
      const raw = item.raw ?? '', indent = /^[ \t]*/.exec(raw)![0];
      const boundary = /\n([ \t]*)<!-- noteboard-list-boundary -->[ \t]*(?:\r?\n[ \t]*)*$/.exec(raw);
      if (boundary?.[1] === indent) { groups.push(group); group = []; }
    }
    if (!groups.length) return parseOrdered(token, helpers);
    if (group.length) groups.push(group);
    return groups.flatMap((items, index) => {
      const marker = /^[ \t]*(\d+)[.)]/.exec(items[0].raw ?? '');
      return parseOrdered({ ...token, items, start: index && marker ? Number(marker[1]) : token.start }, helpers) ?? [];
    });
  },
  markdownTokenizer: {
    ...ordered,
    tokenize(source, tokens, helpers) {
      if (!/^[^\S\n]*[a-zA-Z0-9]+[.)][^\S\n]+/.test(source)) return undefined;
      return ordered.tokenize(source, tokens, helpers);
    },
  },
});

export const MarkdownTaskList = TaskList.extend({
  markdownTokenizer: {
    ...task,
    tokenize(source, tokens, helpers) {
      if (!/^[^\S\n]*[-+*][^\S\n]+\[[ xX]\][^\S\n]+/.test(source)) return undefined;
      return task.tokenize(source, tokens, helpers);
    },
  },
});
