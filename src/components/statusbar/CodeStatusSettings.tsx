import { useCallback, useState, useSyncExternalStore } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { languageFromPath } from '../../core/docKind';
import { getEditorCapabilities, subscribeEditorCapabilities } from '../../core/editor/editorRegistry';
import type { LanguageId } from '../../core/ipc/types';
import { getTextLanguageLabel, TEXT_LANGUAGE_CHOICES } from '../../core/textLanguageTools';
import { useDocumentStore } from '../../stores/documentStore';
import { FileIcon } from '../FileIcon';
import { IndentationMenu } from './IndentationMenu';
import './statusMenus.css';
import './codeStatusSettings.css';

interface CodeStatusSettingsProps {
  docKey: string;
  language: LanguageId;
  preview?: boolean;
}

type LanguageChoice = typeof TEXT_LANGUAGE_CHOICES[number];
const plainText: LanguageChoice = { value: 'plaintext', label: 'Plain Text', iconFileName: '.txt' };
const otherLanguages = TEXT_LANGUAGE_CHOICES.filter(choice => choice.value !== 'plaintext')
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));
let recentLanguages: readonly LanguageChoice[] = [];

export function CodeStatusSettings({ docKey, language, preview }: CodeStatusSettingsProps) {
  return <div className="nb-code-status-settings" key={docKey}>
    {!preview && <><CursorPosition docKey={docKey} /><IndentationMenu docKey={docKey} /></>}
    <LanguagePicker docKey={docKey} language={language} />
  </div>;
}

const noSubscription = () => () => {};
const noPosition = () => undefined;

function CursorPosition({ docKey }: { docKey: string }) {
  const cursor = useSyncExternalStore(
    useCallback(listener => subscribeEditorCapabilities(key => { if (key === docKey) listener(); }), [docKey]),
    useCallback(() => getEditorCapabilities(docKey)?.codeView?.cursor, [docKey]),
  );
  const position = useSyncExternalStore(cursor?.subscribe ?? noSubscription, cursor?.getSnapshot ?? noPosition);
  if (!position) return null;

  const label = `第 ${position.line} 行，第 ${position.column} 列`;
  return <button type="button" className="nb-code-status-trigger nb-code-status-position" aria-label={`跳转到行，当前${label}`}
    title="跳转到行" onClick={() => getEditorCapabilities(docKey)?.codeView?.goToLine()}>
    <span>{label}</span>
  </button>;
}

function LanguagePicker({ docKey, language }: CodeStatusSettingsProps) {
  const label = getTextLanguageLabel(language);
  const [recent, setRecent] = useState(recentLanguages);
  const choose = (value: LanguageId) => useDocumentStore.getState().setLanguage(docKey, value);
  const renderChoice = (choice: LanguageChoice) => <Menu.RadioItem key={choice.value} value={choice.value} textValue={choice.label}
    className="nb-status-menu-item" onSelect={() => {
      if (choice.value !== 'plaintext') {
        recentLanguages = [choice, ...recentLanguages.filter(item => item.value !== choice.value)].slice(0, 5);
        setRecent(recentLanguages);
      }
      choose(choice.value);
    }}>
    <Menu.ItemIndicator className="nb-status-menu-check"><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
    <FileIcon fileName={choice.iconFileName ?? ''} size={15} />
    <span className="nb-code-status-language-label">{choice.label}</span>
  </Menu.RadioItem>;

  return <Menu.Root modal={false}>
    <Menu.Trigger type="button" className="nb-code-status-trigger" aria-label={`语法高亮语言：${label}`} title="切换语法高亮语言">
      <span>{label}</span>
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content className="nb-status-menu nb-code-status-languages" side="top" align="end" sideOffset={5}
        collisionPadding={8} data-shortcuts-suspended aria-label="语法高亮语言">
        {!docKey.startsWith('untitled:') && <>
          <Menu.Item className="nb-status-menu-item" onSelect={() => choose(languageFromPath(docKey))}>按文件名识别</Menu.Item>
          <Menu.Separator className="nb-status-menu-separator" />
        </>}
        <Menu.RadioGroup className="nb-code-status-language-list" value={language} aria-label="语言列表">
          {renderChoice(plainText)}
          {recent.map(renderChoice)}
          {recent.length > 0 && <Menu.Separator className="nb-status-menu-separator" />}
          {otherLanguages.filter(choice => !recent.some(item => item.value === choice.value)).map(renderChoice)}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
