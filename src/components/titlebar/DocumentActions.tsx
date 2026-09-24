import { useEffect, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Home, Plus, FileText, Table2, PencilRuler, Network, GitCompare, Layout,
  ChartColumn, Workflow, GitMerge, Braces, Database, FileCode, CodeXml,
  FolderOpen, Star, Archive, ChevronRight, type LucideIcon } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { on, off, emit } from '../../core/emitter';
import { useLayoutStore } from '../../stores/layoutStore';
import { useWindowStore } from '../../stores/windowStore';
import { useFavoritesStore } from '../../features/favorites/favoritesStore';
import * as actions from '../../features/welcome/welcomeActions';

type Action = { label: string; icon: LucideIcon; run: () => unknown };
const primary: Action[] = [
  { label: '新建 Markdown 笔记 (.md)', icon: FileText, run: actions.newMarkdown },
  { label: '新建文本文档 (.txt)', icon: FileText, run: actions.newText },
  { label: '新建多维表格 (.bitable)', icon: Table2, run: actions.newBitable },
  { label: '新建自由画板 (.excalidraw)', icon: PencilRuler, run: actions.newBoard },
  { label: '新建思维导图 (.mindmap)', icon: Network, run: actions.newMindmap },
  { label: '文本对比', icon: GitCompare, run: actions.newTextDiff },
];
const formats: Action[] = [
  { label: 'Draw.io 架构图 (.drawio)', icon: Layout, run: actions.newDrawio },
  { label: '信息图 (.infographic)', icon: ChartColumn, run: actions.newInfographic },
  { label: 'Mermaid 图表 (.mmd)', icon: Workflow, run: actions.newMermaid },
  { label: 'PlantUML 建模 (.puml)', icon: GitMerge, run: actions.newPlantUml },
  { label: 'JSON 配置文件 (.json)', icon: Braces, run: actions.newJson },
  { label: 'SQL 数据库脚本 (.sql)', icon: Database, run: actions.newSql },
  { label: 'YAML 配置文件 (.yaml)', icon: FileCode, run: actions.newYaml },
  { label: 'XML 标记文档 (.xml)', icon: CodeXml, run: actions.newXml },
];
const openActions: Action[] = [
  { label: '打开文件 (Ctrl+O)', icon: FileText, run: actions.openFileDialog },
  { label: '打开文件夹 (Ctrl+Shift+O)', icon: FolderOpen, run: actions.openFolderDialog },
  { label: '打开收藏夹', icon: Star, run: () => useFavoritesStore.getState().openFavoritesModal() },
  { label: '打开暂存区', icon: Archive, run: actions.openStagingArea },
];
function Items({ items }: { items: Action[] }) {
  return items.map(({ label, icon: Icon, run }) =>
    <Menu.Item key={label} className="titlebar-menu-item" onSelect={() => { void run(); }}>
      <Icon size={14} /><span>{label}</span>
    </Menu.Item>);
}

/** Navigation is fixed before tabs; menu lifecycle never belongs to the tab list. */
export function DocumentActions() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    useLayoutStore.getState().incrementActiveMenu();
    on('close-titlebar-menus', close);
    return () => {
      off('close-titlebar-menus', close);
      useLayoutStore.getState().decrementActiveMenu();
    };
  }, [open]);
  return <div className="titlebar-document-actions">
    <Tooltip content="回到主界面" side="bottom">
      <button type="button" className="titlebar-action" aria-label="回到主界面" onClick={() => {
        emit('close-titlebar-menus', undefined);
        useWindowStore.setState({ activeKey: null });
      }}><Home size={15} /></button>
    </Tooltip>
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content="新建或打开" side="bottom" followCursor disabled={open}>
        <Menu.Trigger asChild>
          <button type="button" className="titlebar-action" aria-label="新建或打开"
            onContextMenu={event => { event.preventDefault(); setOpen(true); }}><Plus size={16} /></button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal><Menu.Content className="titlebar-document-menu" align="start" sideOffset={5} collisionPadding={8}>
        <Items items={primary} />
        <Menu.Separator className="titlebar-menu-separator" />
        <Menu.Sub>
          <Menu.SubTrigger className="titlebar-menu-item"><FileCode size={14} /><span>更多新建格式</span><ChevronRight size={13} /></Menu.SubTrigger>
          <Menu.Portal><Menu.SubContent className="titlebar-document-menu" sideOffset={4} collisionPadding={8}>
            <Items items={formats} />
          </Menu.SubContent></Menu.Portal>
        </Menu.Sub>
        <Menu.Separator className="titlebar-menu-separator" />
        <Items items={openActions} />
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>;
}
