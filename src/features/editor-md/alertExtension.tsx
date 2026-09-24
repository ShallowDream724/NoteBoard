// NoteBoard GitHub Alerts 扩展
// 5 种 alert 类型，消费 --alert-* Token，工具栏/斜杠命令插入
// 详见 docs/09-开发路线图.md 8.6
//
// GitHub Alert 格式:
// > [!NOTE] / > [!TIP] / > [!IMPORTANT] / > [!WARNING] / > [!CAUTION]

import { AlertNode } from './documentNodes';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { completeAlert } from './alertCommands';
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
export const GitHubAlert = AlertNode.extend({
  addNodeView() { return ReactNodeViewRenderer(AlertComponent); },
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
        return completeAlert(this.editor, match[1].toLowerCase() as AlertKind);
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
