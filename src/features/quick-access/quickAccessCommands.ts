import { additionalNewDocumentActions, primaryNewDocumentActions } from '../../components/titlebar/NewDocumentMenu';
import { isRichDocument } from '../../core/docKind';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { emit } from '../../core/emitter';
import { getFileFormat, textToolbarKind } from '../../core/fileFormats';
import { toggleFilePreviewMode } from '../editor-code/filePreviewMode';
import { commandBindings, commandForDefault } from '../../core/shortcutBindings';
import { SHORTCUTS } from '../../core/shortcutCatalog';
import { getRegisteredShortcuts } from '../../core/shortcuts';
import { useLayoutStore } from '../../stores/layoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWindowStore } from '../../stores/windowStore';
import { useFavoritesStore } from '../favorites/favoritesStore';
import { openDocumentSearch, type DocumentSearchSelection } from '../search/openDocumentSearch';
import { openStagingArea } from '../welcome/welcomeActions';
import { QUICK_ACCESS_COMMANDS, type QuickCommand } from './quickAccessItems';

const REQUIRES_TAB = new Set(['file.save', 'file.saveAs', 'tab.close']);
const REQUIRES_RICH = new Set(['file.export', 'file.print']);
const REQUIRES_SEARCH = new Set(['search.find', 'search.replace']);

export function quickAccessCommands(pureMarkdown: boolean, searchSelection?: DocumentSearchSelection): QuickCommand[] {
  const tab = useWindowStore.getState().activeTab();
  const isRich = isRichDocument(tab?.kind);
  const canShowNavigation = isRich && tab?.viewMode !== 'source';
  const canSearch = !!tab && (isRich || tab.kind === 'code') && !!getEditorCapabilities(tab.key)?.search;
  const registered = new Map(getRegisteredShortcuts().filter(entry => entry.scope === 'global' && (entry.when?.() ?? true))
    .map(entry => [entry.id ?? commandForDefault(entry.key), entry.action]));
  const result: QuickCommand[] = [];
  for (const { id, label, group, contexts } of SHORTCUTS) {
    if (!contexts.includes('app') || id === QUICK_ACCESS_COMMANDS.commands || id === QUICK_ACCESS_COMMANDS.files) continue;
    if ((!tab && REQUIRES_TAB.has(id)) || (!isRich && REQUIRES_RICH.has(id)) || (!canSearch && REQUIRES_SEARCH.has(id))) continue;
    if (id === 'layout.outline' && !canShowNavigation) continue;
    const action = registered.get(id);
    if (!action) continue;
    const run = id === 'search.find' ? () => openDocumentSearch('search', searchSelection)
      : id === 'search.replace' ? () => openDocumentSearch('replace', searchSelection) : action;
    result.push({ id, label, detail: group, run, type: 'command', shortcut: commandBindings(id).at(0) });
  }
  const add = (id: string, label: string, detail: string, run: () => unknown) => {
    result.push({ id, label, detail, run, type: 'command', shortcut: commandBindings(id).at(0) });
  };
  add('workspace.settings', '打开设置', '文件与窗口', () => useLayoutStore.getState().setSettingsModalVisible(true));
  add('workspace.favorites', '打开收藏夹', '文件与窗口', () => useFavoritesStore.getState().openFavoritesModal());
  add('workspace.staging', '打开暂存区', '文件与窗口', openStagingArea);
  if (isRich && tab) {
    add('markdown.mode', tab.viewMode === 'source' ? '切换为可视化模式' : '切换为源码模式', 'Markdown · 源码与可视化',
      () => emit('toggle-md-view-mode', { key: tab.key }));
  } else if (tab?.kind === 'code' && getFileFormat(tab.key).preview === 'html') {
    add('markdown.mode', tab.viewMode === 'source' ? '预览 HTML' : '查看 HTML 源码', 'HTML', () => toggleFilePreviewMode(tab.key));
  }
  const ops = tab?.kind === 'code' && getEditorCapabilities(tab.key)?.codeOps;
  if (tab && ops) {
    add('source.wrap', '切换自动换行', '代码显示', () => {
      const settings = useSettingsStore.getState();
      return settings.setEditor({ softWrap: !settings.settings.editor.softWrap });
    });
    const kind = textToolbarKind(tab.path ?? tab.displayName);
    if (kind === 'json') {
      add('json.formatSelection', '格式化选中的 JSON', 'JSON', () => ops.expandJson({ scope: 'selection', tabSize: useSettingsStore.getState().settings.editor.tabSize }));
      add('json.minifySelection', '压缩选中的 JSON', 'JSON', () => ops.minifyJson('selection'));
      add('json.validateSelection', '校验选中的 JSON', 'JSON', () => ops.validateJson('selection'));
    } else if (kind === 'xml') {
      add('xml.formatSelection', '格式化选中的 XML', 'XML', () => ops.formatXml('selection'));
    }
  }
  if (canShowNavigation) {
    add('document.bookmarks', '显示文档书签', '文档导航', () => {
      const layout = useLayoutStore.getState();
      layout.setNavigationTab('bookmarks');
      layout.setOutlineVisible(true);
    });
  }
  for (const { label, run } of primaryNewDocumentActions(pureMarkdown)) add(`new:${label}`, label, '新建', run);
  for (const { label, run } of additionalNewDocumentActions) add(`new:${label}`, `新建${label}`, '新建', run);
  return result;
}
