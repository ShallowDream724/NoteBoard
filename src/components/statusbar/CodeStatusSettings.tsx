import { useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, Search } from 'lucide-react';
import { languageFromPath } from '../../core/docKind';
import type { LanguageId } from '../../core/ipc/types';
import { getTextLanguageLabel, searchTextLanguages } from '../../core/textLanguageTools';
import { useDocumentStore } from '../../stores/documentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import './codeStatusSettings.css';

interface CodeStatusSettingsProps {
  docKey: string;
  language: LanguageId;
  showLanguage?: boolean;
}

const autoLabel = '按文件名自动识别';
const indentWidths = [1, 2, 3, 4, 5, 6, 7, 8];

export function CodeStatusSettings({ docKey, language, showLanguage = true }: CodeStatusSettingsProps) {
  return <div className="nb-code-status-settings" key={docKey}>
    {showLanguage && <LanguagePicker docKey={docKey} language={language} />}
    <IndentationPicker />
  </div>;
}

function LanguagePicker({ docKey, language }: Pick<CodeStatusSettingsProps, 'docKey' | 'language'>) {
  const [open, setOpen] = useState(false);
  const label = getTextLanguageLabel(language);

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger type="button" className="nb-code-status-trigger" aria-label={`语法高亮语言：${label}`} title="切换语法高亮语言">
      <span>{label}</span>
    </Popover.Trigger>
    <Popover.Portal>
      <LanguageOptions language={language} detectedLanguage={languageFromPath(docKey)} choose={value => {
        useDocumentStore.getState().setLanguage(docKey, value);
        setOpen(false);
      }} />
    </Popover.Portal>
  </Popover.Root>;
}

function LanguageOptions({ language, detectedLanguage, choose }: {
  language: LanguageId;
  detectedLanguage: LanguageId;
  choose: (language: LanguageId) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const id = useId();
  const search = query.trim().toLowerCase();
  const showAuto = !search || autoLabel.includes(search) || 'auto'.startsWith(search);
  const options = [
    ...(showAuto ? [{ key: 'auto', value: detectedLanguage, label: autoLabel, detail: getTextLanguageLabel(detectedLanguage) }] : []),
    ...searchTextLanguages(search).map(choice => ({
      key: choice.value,
      value: choice.value,
      label: choice.label,
      detail: choice.extensions.slice(0, 3).map(extension => `.${extension}`).join(' '),
    })),
  ];

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return <Popover.Content className="nb-code-status-popup nb-code-status-languages" side="top" align="end" sideOffset={5}
    collisionPadding={8} data-shortcuts-suspended aria-label="语法高亮语言"
    onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }); }}>
    <div className="nb-code-status-search">
      <Search size={14} aria-hidden="true" />
      <input ref={input} role="combobox" aria-label="搜索语言名称或扩展名" aria-autocomplete="list" aria-expanded="true"
        aria-controls={id} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        placeholder="搜索语言名称或扩展名" value={query} onChange={event => {
          setQuery(event.target.value);
          setActive(-1);
          if (list.current) list.current.scrollTop = 0;
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || options.length === 0) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActive(current => current < 0 ? (direction === 1 ? 0 : options.length - 1) : Math.max(0, Math.min(options.length - 1, current + direction)));
          }
          if (event.key === 'Enter' && (active >= 0 || search)) {
            event.preventDefault();
            choose(options[Math.max(0, active)].value);
          }
        }} />
    </div>
    <div className="nb-code-status-language-list" id={id} role="listbox" aria-label="语言列表" ref={list}>
      {options.map((option, index) => {
        const selected = option.key === language;
        return <button type="button" role="option" aria-selected={selected} tabIndex={-1} id={`${id}-${index}`} key={option.key}
          ref={index === active ? activeOption : undefined} data-active={index === active || undefined} className="nb-code-status-language-option"
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}>
          <span>{option.label}</span>
          <small>{option.detail}</small>
          <span className="nb-code-status-option-mark">{selected && <Check size={14} aria-hidden="true" />}</span>
        </button>;
      })}
    </div>
    {options.length === 0 && <p className="nb-code-status-empty" role="status">无匹配语言</p>}
  </Popover.Content>;
}

function IndentationPicker() {
  const tabSize = useSettingsStore(state => state.settings.editor.tabSize);
  const insertSpaces = useSettingsStore(state => state.settings.editor.insertSpaces) !== false;
  const setEditor = useSettingsStore(state => state.setEditor);
  const width = Math.max(1, Math.min(8, Math.trunc(tabSize) || 2));
  const label = `${insertSpaces ? '空格' : 'Tab'} ${width}`;

  return <Popover.Root>
    <Popover.Trigger type="button" className="nb-code-status-trigger" aria-label={`缩进：${label}`} title="更改缩进设置">
      <span>{label}</span>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="nb-code-status-popup nb-code-status-indent" side="top" align="end" sideOffset={5}
        collisionPadding={8} data-shortcuts-suspended aria-label="缩进设置">
        <label><span>缩进方式</span>
          <select value={insertSpaces ? 'spaces' : 'tabs'} onChange={event => void setEditor({ insertSpaces: event.target.value === 'spaces' })}>
            <option value="spaces">空格</option>
            <option value="tabs">Tab</option>
          </select>
        </label>
        <label><span>Tab 宽度</span>
          <select value={width} onChange={event => void setEditor({ tabSize: Number(event.target.value) })}>
            {indentWidths.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
