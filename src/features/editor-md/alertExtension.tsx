import { lazy, Suspense, useState } from 'react';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import * as Popover from '@radix-ui/react-popover';
import { Palette } from 'lucide-react';
import { AlertNode } from './documentNodes';
import { completeAlert, updateCallout } from './alertCommands';
import { ALERT_META, type AlertKind } from './alertPresentation';
import { calloutAttributes, calloutEmoji, calloutStyle, calloutTitle, isAlertKind, normalizeAlertInput } from './calloutPresentation';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import { AnnotationMarker } from './annotations/AnnotationMarker';
import { annotationMarkerId } from './annotations/marker';
import './callout.css';

export type { AlertKind } from './alertPresentation';
const CalloutMenu = lazy(() => import('./CalloutMenu'));

function AlertComponent({ node, editor, getPos, selected, decorations }: NodeViewProps) {
  const attrs = calloutAttributes(node.attrs), title = calloutTitle(attrs), emoji = calloutEmoji(attrs);
  const meta = ALERT_META[isAlertKind(attrs.icon) ? attrs.icon : attrs.kind];
  const [menu, setMenu] = useState<'appearance' | 'icon' | null>(null);
  const nativeVisible = useNativeFeatureVisibility();
  const update = (patch: Parameters<typeof updateCallout>[2]) => {
    const pos = getPos(); if (pos !== undefined) updateCallout(editor, pos, patch);
  };
  return <NodeViewWrapper as="div" className={'github-alert github-alert-' + attrs.kind + (selected ? ' is-selected' : '')}
    data-alert={attrs.kind} data-callout-colored-text={!!(attrs.textColor || attrs.backgroundColor) || undefined}
    data-callout-menu-open={!!menu || undefined} data-annotation-toolbar={!!annotationMarkerId(decorations) || undefined} style={calloutStyle(attrs)}>
    <Popover.Root open={menu !== null} onOpenChange={open => { if (!open) setMenu(null); }}>
      <Popover.Anchor asChild><button type="button" contentEditable={false} className="callout-icon callout-icon-button"
        title="更换提示块图标" aria-label="更换提示块图标" aria-expanded={menu === 'icon'} onPointerDown={event => event.preventDefault()} onClick={() => setMenu(menu === 'icon' ? null : 'icon')}>
        {emoji || <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={meta.icon}/></svg>}
      </button></Popover.Anchor>
      {title && (nativeVisible ? <button type="button" contentEditable={false} className="alert-title callout-title-button" title="编辑提示块标题"
        onPointerDown={event => event.preventDefault()} onClick={() => setMenu(menu === 'appearance' ? null : 'appearance')}>{title}</button>
        : <div className="alert-title" contentEditable={false}>{title}</div>)}
      <div className="nb-annotation-toolbar-actions nb-callout-actions" contentEditable={false}>
      <AnnotationMarker decorations={decorations}/>
      {nativeVisible && <button type="button" contentEditable={false} className="callout-palette" title="提示块外观" aria-label="提示块外观"
        aria-expanded={menu === 'appearance'} onPointerDown={event => event.preventDefault()} onClick={() => setMenu(menu === 'appearance' ? null : 'appearance')}><Palette size={15}/></button>}
      </div>
      {menu && <Popover.Portal><Popover.Content contentEditable={false} data-nb-editor-menu className="callout-menu" side="bottom" align="start"
        sideOffset={8} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
        <Suspense fallback={<div className="callout-menu-heading">提示块</div>}><CalloutMenu attrs={attrs} mode={menu}
          nativeVisible={nativeVisible} onChange={update}/></Suspense>
      </Popover.Content></Popover.Portal>}
    </Popover.Root>
    <NodeViewContent className="alert-body"/>
  </NodeViewWrapper>;
}

/** One semantic callout node, with GFM presets and native presentation attributes. */
export const GitHubAlert = AlertNode.extend({
  addOptions() { return { ...this.parent?.(), ownsAnnotationMarker: true }; },
  addNodeView() { return ReactNodeViewRenderer(AlertComponent); },
  addKeyboardShortcuts() {
    return { Enter: () => {
      const { state, view } = this.editor, { $from } = state.selection;
      if (view.composing || !state.selection.empty || $from.parent.type.name !== 'paragraph'
        || $from.parentOffset !== $from.parent.content.size) return false;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.exec(normalizeAlertInput($from.parent.textContent.trim()));
      return match ? completeAlert(this.editor, match[1].toLowerCase() as AlertKind) : false;
    } };
  },
  addCommands() {
    return { insertAlert: (kind: AlertKind) => ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) =>
      commands.insertContent({ type: 'githubAlert', attrs: { kind }, content: [{ type: 'paragraph' }] }) } as never;
  },
});

export const ALERT_KINDS = Object.keys(ALERT_META) as AlertKind[];
export { ALERT_META };
