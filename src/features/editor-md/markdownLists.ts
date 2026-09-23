import { OrderedList, TaskList } from '@tiptap/extension-list';

const ordered = OrderedList.config.markdownTokenizer!;
const task = TaskList.config.markdownTokenizer!;

// Upstream list tokenizers split their entire remaining source before checking
// its first line. Reject impossible prefixes before entering that allocation.
// These guards are deliberately permissive; upstream retains grammar authority.
export const MarkdownOrderedList = OrderedList.extend({
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
