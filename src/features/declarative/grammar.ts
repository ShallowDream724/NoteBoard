import { Extension, Mark, Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { DeclarativeBlock, DeclarativeInline } from './syntax';
import { inheritAuthoringSource } from './sourceCache';

/** Literal recovery is deliberately a schema node, never re-executed Markdown. */
export const AuthoringRaw = Node.create({
  name: 'authoringRaw', group: 'block', content: 'text*', code: true, defining: true,
  parseHTML() { return [{ tag: 'pre[data-authoring-raw]' }]; },
  renderHTML() { return ['pre', { 'data-authoring-raw': '', class: 'nb-authoring-error' }, ['code', {}, 0]]; },
  renderMarkdown(node) { return node.content?.map(child => child.text ?? '').join('') ?? ''; },
});
export const AuthoringLiteral = Mark.create({
  name: 'authoringLiteral', inclusive: false, excludes: '',
  parseHTML() { return [{ tag: 'span[data-authoring-literal]' }]; },
  renderHTML() { return ['span', { 'data-authoring-literal': '' }, 0]; },
  renderMarkdown(node, helpers) { return helpers.renderChildren(node); },
});
export const AuthoringProvenance = Extension.create({ name: 'authoringProvenance', addProseMirrorPlugins() { return [new Plugin({ state: { init: () => null, apply(transaction, value, oldState, newState) { if (transaction.docChanged) inheritAuthoringSource(oldState.doc, newState.doc); return value; } } })]; } });
export const declarativeGrammar = [AuthoringRaw, AuthoringLiteral, DeclarativeBlock, DeclarativeInline, AuthoringProvenance];
