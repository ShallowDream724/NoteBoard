// NoteBoard GitHub Alerts 扩展
// 5 种 alert 类型，消费 --alert-* Token，工具栏/斜杠命令插入
// 详见 docs/09-开发路线图.md 8.6
//
// GitHub Alert 格式:
// > [!NOTE] / > [!TIP] / > [!IMPORTANT] / > [!WARNING] / > [!CAUTION]

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useState } from 'react';
import { ALERT_META, alertKind, type AlertKind } from './alertPresentation';

export type { AlertKind } from './alertPresentation';

function AlertComponent({ node, updateAttributes, selected }: NodeViewProps) {
  const kind = alertKind(node.attrs.kind);
  const meta = ALERT_META[kind];
  const [choosingKind, setChoosingKind] = useState(false);

  return (
    <NodeViewWrapper
      as="div"
      className={'github-alert github-alert-' + kind}
      selected={selected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <div
        contentEditable={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          fontSize: '1em',
          fontWeight: 600,
          color: `var(--alert-${kind}-border)`,
        }}
      >
        <button type="button" className="alert-kind-toggle" title="更改提示块类型"
          aria-label={'更改提示块类型，当前 ' + meta.label} onClick={() => setChoosingKind(!choosingKind)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={meta.icon} />
          </svg>
          <span>{meta.label}</span>
        </button>
        {choosingKind && (
        <select
          aria-label="提示块类型"
          className="alert-kind-picker"
          autoFocus
          value={kind}
          onChange={(e) => { updateAttributes({ kind: e.target.value }); setChoosingKind(false); }}
          onBlur={() => setChoosingKind(false)}
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            padding: '2px 4px',
            border: '1px solid var(--editor-border)',
            borderRadius: 3,
            background: 'transparent',
            color: 'var(--editor-text)',
          }}
        >
          {Object.entries(ALERT_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        )}
      </div>
      <NodeViewContent className="alert-body" style={{ flex: 1, minHeight: '1.5em' }} />
    </NodeViewWrapper>
  );
}

/** GitHub Alert 节点 */
export const GitHubAlert = Node.create({
  name: 'githubAlert',
  group: 'block',
  content: 'block+',
  selectable: true,
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'note' as AlertKind,
        parseHTML: (element) => alertKind(element.getAttribute('data-alert') || element.getAttribute('kind')),
        renderHTML: (attributes) => ({ 'data-alert': alertKind(attributes.kind) }),
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'div[data-alert]', contentElement: (element) => element.querySelector('.alert-body') ?? element },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const kind = alertKind(HTMLAttributes['data-alert']);
    const meta = ALERT_META[kind];
    return ['div', mergeAttributes(HTMLAttributes, { class: 'github-alert github-alert-' + kind }),
      ['div', { class: 'alert-title' },
        ['http://www.w3.org/2000/svg svg', {
          width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
        }, ['http://www.w3.org/2000/svg path', { d: meta.icon }]],
        ['span', {}, meta.label]],
      ['div', { class: 'alert-body' }, 0]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AlertComponent);
  },
  markdownTokenName: 'githubAlert',
  markdownTokenizer: {
    name: 'githubAlert',
    level: 'block',
    start: (source) => /^ {0,3}>[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im.exec(source)?.index ?? -1,
    tokenize(source, _tokens, lexer) {
      const header = /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i.exec(source);
      if (!header) return undefined;
      let end = header[0].length;
      const lines: string[] = [];
      while (end < source.length) {
        const line = /^ {0,3}>[ \t]?([^\r\n]*)(?:\r?\n|$)/.exec(source.slice(end));
        if (!line || /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(line[1])) break;
        lines.push(line[1]);
        end += line[0].length;
      }
      return { type: 'githubAlert', raw: source.slice(0, end), kind: header[1].toLowerCase(),
        tokens: lexer.blockTokens(lines.join('\n')) };
    },
  },
  parseMarkdown(token, helpers) {
    const children = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? []);
    return helpers.createNode('githubAlert', { kind: token.kind ?? 'note' },
      children.length ? children : [{ type: 'paragraph' }]);
  },
  renderMarkdown(node, helpers) {
    const kind = String(node.attrs?.kind ?? 'note').toUpperCase();
    const body = helpers.renderChildren(node.content ?? [], '\n\n');
    return '> [!' + kind + ']\n' + body.split('\n').map((line) => line ? '> ' + line : '>').join('\n');
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if (view.composing || !state.selection.empty || $from.depth < 2
          || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size
          || $from.node(-1).type.name !== 'blockquote' || $from.node(-1).childCount !== 1) return false;
        const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.exec($from.parent.textContent.trim());
        if (!match) return false;
        const pos = $from.before($from.depth - 1);
        const tr = state.tr.replaceWith(pos, $from.after($from.depth - 1),
          this.type.create({ kind: match[1].toLowerCase() }, this.editor.schema.nodes.paragraph.create()));
        tr.setSelection(TextSelection.create(tr.doc, pos + 2));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
  addCommands() {
    return {
      insertAlert:
        (kind: AlertKind) =>
        ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => {
          return commands.insertContent({
            type: 'githubAlert',
            attrs: { kind },
            content: [{ type: 'paragraph' }],
          });
        },
    } as never;
  },
});

/** Alert 种类列表（供斜杠命令使用） */
export const ALERT_KINDS = Object.keys(ALERT_META) as AlertKind[];
export { ALERT_META };
