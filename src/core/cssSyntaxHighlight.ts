import { tagHighlighter, tags as t } from '@lezer/highlight';

/** Shared by CodeMirror (including HTML style blocks) and the code-fence worker. */
export const cssSyntaxHighlighter = tagHighlighter([
  { tag: t.comment, class: 'hljs-comment' },
  { tag: t.keyword, class: 'hljs-keyword' },
  { tag: t.tagName, class: 'hljs-selector-tag' },
  { tag: [t.className, t.constant(t.className)], class: 'hljs-selector-class' },
  { tag: t.labelName, class: 'hljs-selector-id' },
  { tag: [t.propertyName, t.attributeName], class: 'hljs-css-property' },
  { tag: t.variableName, class: 'hljs-variable' },
  { tag: [t.atom, t.namespace], class: 'hljs-css-value' },
  { tag: [t.number, t.color, t.unit], class: 'hljs-number' },
  { tag: t.string, class: 'hljs-string' },
  { tag: t.modifier, class: 'hljs-meta' },
  { tag: [t.operator, t.punctuation], class: 'hljs-punctuation' },
], {
  scope: type => type.name === 'StyleSheet',
});
