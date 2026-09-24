import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import { ALERT_META, matchAlertChoices, type AlertKind } from './alertPresentation';
import { completeAlert } from './alertCommands';
import './typingAssist.css';

const key = new PluginKey('alertCompletion');

export const AlertCompletion = Extension.create({
  name: 'alertCompletion', priority: 1200,
  addProseMirrorPlugins() {
    return [Suggestion<{ kind: AlertKind; description: string }, AlertKind>({
      editor: this.editor, pluginKey: key, char: '!',
      findSuggestionMatch: ({ $position }) => {
        const parent = $position.parent;
        if (parent.type.name !== 'paragraph' || parent.content.size > 14 || $position.depth < 2
          || $position.node(-1).type.name !== 'blockquote' || $position.node(-1).childCount !== 1) return null;
        const text = parent.textContent;
        if (!/^\[![a-z]*\]?$/i.test(text) || !/^(?:\]|)$/.test(text.slice($position.parentOffset))) return null;
        const match = /^\[!([a-z]*)\]?$/i.exec(text.slice(0, $position.parentOffset));
        if (!match || !matchAlertChoices(match[1]).length) return null;
        return { range: { from: $position.start(), to: $position.end() }, query: match[1], text };
      },
      allow: ({ editor }) => !editor.view.composing,
      items: ({ query }) => matchAlertChoices(query),
      command: ({ editor, props }) => { completeAlert(editor, props); },
      render: () => {
        let popup: HTMLDivElement | null = null;
        let current: SuggestionProps<{ kind: AlertKind; description: string }, AlertKind>;
        let selected = 0;
        let unmount: (() => void) | undefined;
        const markSelected = () => popup?.querySelectorAll<HTMLButtonElement>('[role=option]').forEach((button, index) => {
          button.setAttribute('aria-selected', String(index === selected));
          if (index === selected) button.scrollIntoView({ block: 'nearest' });
        });
        const render = (props: typeof current) => {
          current = props; selected = 0;
          if (!popup) return;
          popup.replaceChildren();
          const title = document.createElement('div'); title.className = 'nb-assist-title'; title.textContent = '提示块'; popup.append(title);
          props.items.forEach((item, index) => {
            const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.tabIndex = -1;
            const name = document.createElement('strong'); name.textContent = ALERT_META[item.kind].label; name.style.color = ALERT_META[item.kind].color;
            const detail = document.createElement('span'); detail.textContent = item.description;
            button.append(name, detail); button.onmousedown = event => event.preventDefault();
            button.onmouseenter = () => { selected = index; markSelected(); };
            button.onclick = () => props.command(item.kind); popup!.append(button);
          });
          markSelected();
        };
        return {
          onStart: props => {
            popup = document.createElement('div'); popup.className = 'nb-alert-completion'; popup.role = 'listbox'; popup.ariaLabel = '提示块类型';
            render(props); unmount = props.mount(popup);
          },
          onUpdate: render,
          onKeyDown: ({ event, view }) => {
            if (event.isComposing) return false;
            if (event.key === 'Escape') { exitSuggestion(view, key); return true; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + current.items.length) % current.items.length;
              markSelected(); return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') { current.command(current.items[selected].kind); return true; }
            return false;
          },
          onExit: () => { unmount?.(); unmount = undefined; popup = null; },
        };
      },
    })];
  },
});
