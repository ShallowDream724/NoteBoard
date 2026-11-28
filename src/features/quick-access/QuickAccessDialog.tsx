import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import * as Dialog from '@radix-ui/react-dialog';
import { Bookmark, Hash, Search, Terminal } from 'lucide-react';
import { FileIcon } from '../../components/FileIcon';
import { listRecent, listWorkspaceFiles } from '../../core/ipc/commands';
import { matchesShortcut } from '../../core/shortcutBindings';
import { useShortcutBindings } from '../../core/useShortcutBindings';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../../stores/toastStore';
import { useWindowStore } from '../../stores/windowStore';
import { openDocument } from '../editor-code/orchestration/openDocument';
import { useExplorerStore } from '../explorer/explorerStore';
import { checkOpenDocumentStillExists } from '../external/missingFileGuard';
import { quickAccessCommands } from './quickAccessCommands';
import { filePathItem, matchQuickAccessItems, mergeQuickFiles, QUICK_ACCESS_COMMANDS } from './quickAccessItems';
import type { QuickAccessMode, QuickAccessRequest, QuickCommand, QuickFile, QuickNavigation } from './quickAccessItems';
import { useQuickNavigation } from './useQuickNavigation';
import './quickAccess.css';

const RESULT_LIMIT = 50;
const fileOrder = new Intl.Collator('zh-CN', { numeric: true });
type Result = QuickCommand | QuickFile | QuickNavigation;

export default function QuickAccessDialog({ request, visualEditor, onClose }: {
  request: QuickAccessRequest; visualEditor: Editor | null; onClose: () => void;
}) {
  const [mode, setMode] = useState(request.mode);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filesOpened, setFilesOpened] = useState(request.mode === 'files');
  const [workspaceQueried, setWorkspaceQueried] = useState(false);
  const [recent, setRecent] = useState<QuickFile[] | 'error' | null>(null);
  const [workspace, setWorkspace] = useState<{ key: string; files: QuickFile[]; limited: boolean; error?: boolean }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const onDismiss = useRef<(() => unknown) | null>(null);
  const listId = useId();

  const tabs = useWindowStore(state => state.tabs);
  const activeKey = useWindowStore(state => state.activeKey);
  const root = useExplorerStore(state => state.workspaceRoot);
  const showHidden = useSettingsStore(state => state.settings.file.showHiddenFiles);
  const pureMarkdown = useSettingsStore(state => state.settings.editor.pureMarkdown ?? false);
  useShortcutBindings();
  const navigationAvailable = !!visualEditor && !visualEditor.isDestroyed;
  const isCurrent = useCallback((editor: Editor) => {
    const tab = useWindowStore.getState().activeTab();
    return !editor.isDestroyed && !!tab && tab.key === activeKey && tab.viewMode !== 'source';
  }, [activeKey]);
  const navigation = useQuickNavigation(mode === 'navigation' ? visualEditor : null, isCurrent);
  const workspaceKey = root ? JSON.stringify([root, showHidden]) : '';
  const indexedWorkspace = workspace?.key === workspaceKey ? workspace : undefined;

  useEffect(() => {
    if (!filesOpened) return;
    let current = true;
    void listRecent().then(({ files }) => {
      if (current) setRecent(files.map(({ path }) => filePathItem(path, '最近打开')));
    }).catch(() => { if (current) setRecent('error'); });
    return () => { current = false; };
  }, [filesOpened]);

  useEffect(() => {
    if (!root || !workspaceQueried) return;
    let current = true;
    void listWorkspaceFiles(root, showHidden).then(({ paths, limited }) => {
      if (!current) return;
      const files = paths.map(path => filePathItem(path, '工作区'));
      files.sort((left, right) => fileOrder.compare(left.label, right.label) || left.id.localeCompare(right.id));
      setWorkspace({ key: workspaceKey, files, limited });
    }).catch(() => { if (current) setWorkspace({ key: workspaceKey, files: [], limited: false, error: true }); });
    return () => { current = false; };
  }, [root, showHidden, workspaceKey, workspaceQueried]);

  const openTabs = useMemo(() => tabs.map((tab): QuickFile => ({
    ...(tab.path ? filePathItem(tab.path, '已打开') : { id: tab.key, type: 'file', path: null, source: '已打开' }),
    label: tab.displayName,
    tabKey: tab.key,
  })).sort((left, right) => Number(right.tabKey === activeKey) - Number(left.tabKey === activeKey)), [tabs, activeKey]);
  const hasQuery = query.trim() !== '';
  const files = useMemo(() => mergeQuickFiles(openTabs, Array.isArray(recent) ? recent : [], hasQuery ? indexedWorkspace?.files ?? [] : []),
    [openTabs, recent, hasQuery, indexedWorkspace]);
  const source = mode === 'files' ? files : mode === 'commands' ? quickAccessCommands(pureMarkdown, request.searchSelection) : navigation;
  const matches = matchQuickAccessItems<Result>(source, query);
  const results = matches.slice(0, RESULT_LIMIT);
  const activeIndex = Math.max(0, results.findIndex(item => item.id === selectedId));
  const active = results[activeIndex];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active?.id]);

  function switchMode(nextMode: QuickAccessMode, nextQuery = '') {
    if (mode !== nextMode) {
      setMode(nextMode);
      setQuery(nextQuery);
      setSelectedId(null);
    }
    if (nextMode === 'files') setFilesOpened(true);
    inputRef.current?.focus();
  }

  function close(action?: () => unknown) {
    if (closing.current) return;
    closing.current = true;
    onDismiss.current = action ?? null;
    onClose();
  }

  function run(result: Result) {
    if (result.type !== 'file') { close(result.run); return; }
    close(() => {
      const { tabKey, path } = result;
      const win = useWindowStore.getState();
      if (tabKey && win.getTab(tabKey)) {
        win.activateTab(tabKey);
        void checkOpenDocumentStillExists(tabKey, true).catch(() => {});
      } else if (path) return openDocument(path);
    });
  }

  function onDialogKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const nextMode = matchesShortcut(QUICK_ACCESS_COMMANDS.files, event.nativeEvent) ? 'files'
      : matchesShortcut(QUICK_ACCESS_COMMANDS.commands, event.nativeEvent) ? 'commands' : null;
    if (nextMode) {
      event.preventDefault();
      switchMode(nextMode);
      return;
    }
    if (event.target !== inputRef.current || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !active) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      run(active);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedId(results[Math.max(0, Math.min(results.length - 1, activeIndex + step))].id);
    }
  }

  const fileMode = mode === 'files';
  const commandMode = mode === 'commands';
  const title = fileMode ? '快速打开文件' : commandMode ? '命令面板' : '文档导航';
  const inputLabel = fileMode ? '查找文件' : commandMode ? '查找命令' : '查找标题或书签';
  const placeholder = fileMode ? '输入文件名或路径' : commandMode ? '输入命令名称' : '输入标题或书签名称';
  const Icon = fileMode ? Search : commandMode ? Terminal : Hash;
  const searching = fileMode && (recent === null || (!!root && hasQuery && !indexedWorkspace));
  const scope = root ? `工作区 · ${root}` : '已打开与最近打开的文件';
  const status = searching ? '正在查找文件…'
    : fileMode && hasQuery && indexedWorkspace?.error ? '无法读取工作区文件'
    : fileMode && hasQuery && indexedWorkspace?.limited ? '已达到工作区查找上限，部分文件未列出'
    : matches.length > RESULT_LIMIT ? `显示前 ${RESULT_LIMIT} 项，继续输入以缩小范围`
    : fileMode && recent === 'error' ? '无法读取最近打开的文件'
    : '';

  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="nb-quick-access-overlay" />
      <Dialog.Content className="nb-quick-access" aria-describedby={undefined} data-shortcuts-suspended
        onKeyDown={onDialogKeyDown}
        onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}
        onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (request.previousFocus?.isConnected) request.previousFocus.focus({ preventScroll: true });
          if (onDismiss.current) {
            void Promise.resolve().then(onDismiss.current).catch(error => showToast(String(error), 'error'));
          }
        }}>
        <Dialog.Title className="nb-quick-access-sr">{title}</Dialog.Title>
        <div className="nb-quick-access-modes">
          <button type="button" aria-pressed={fileMode} onClick={() => switchMode('files')}>文件</button>
          <button type="button" aria-pressed={commandMode} onClick={() => switchMode('commands')}>命令</button>
          {(navigationAvailable || mode === 'navigation') && <button type="button" aria-pressed={mode === 'navigation'}
            onClick={() => switchMode('navigation')}>导航</button>}
        </div>
        <div className="nb-quick-access-input">
          <Icon size={17} aria-hidden />
          <input role="combobox" aria-label={inputLabel} aria-autocomplete="list"
            aria-controls={listId} aria-expanded={true} aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined}
            ref={inputRef} value={query} spellCheck={false} autoComplete="off"
            placeholder={placeholder}
            onChange={event => {
              const nextQuery = event.target.value;
              if (fileMode && nextQuery.startsWith('>')) { switchMode('commands', nextQuery.slice(1).trimStart()); return; }
              if (fileMode && navigationAvailable && nextQuery.startsWith('@')) { switchMode('navigation', nextQuery.slice(1).trimStart()); return; }
              setQuery(nextQuery);
              setSelectedId(null);
              if (fileMode && nextQuery.trim()) setWorkspaceQueried(true);
            }} />
        </div>
        <div className="nb-quick-access-results" role="listbox" id={listId} aria-label={inputLabel} ref={listRef}>
          {results.map((item, index) => <div className="nb-quick-access-result" key={item.id}
            id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
            title={item.type === 'file' ? item.detail : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => run(item)}>
            {item.type === 'file' ? <FileIcon fileName={item.label} size={16} /> : item.type === 'command' ? <Terminal size={15} aria-hidden />
              : item.type === 'heading' ? <Hash size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
            <span className="nb-quick-access-text">
              <span>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </span>
            {item.type === 'file' ? <small>{item.source}</small> : item.type === 'command' && item.shortcut && <kbd>{item.shortcut}</kbd>}
          </div>)}
        </div>
        {!results.length && !searching && <div className="nb-quick-access-empty">
          {hasQuery ? '未找到匹配项' : fileMode ? '输入文件名或路径以查找' : '当前文档暂无可跳转的标题或书签'}
        </div>}
        <div className="nb-quick-access-footer">
          <span role="status" data-message={status ? '' : undefined} title={fileMode && !status ? scope : undefined}>{status || (fileMode ? scope : '')}</span>
          <div><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> {fileMode ? '打开' : commandMode ? '执行' : '跳转'} <kbd>Esc</kbd> 关闭</div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
