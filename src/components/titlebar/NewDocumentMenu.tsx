import { useEffect, useRef, useState, type ComponentType } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Plus, FileText, GitCompare, FileCode,
  FolderOpen, Star, Archive, ChevronRight } from 'lucide-react';
import { createFileTypeIcon, NoteBoardFileIcon } from '../FileIcon';
import { Tooltip } from '../Tooltip';
import { on, off } from '../../core/emitter';
import { useLayoutStore } from '../../stores/layoutStore';
import { useFavoritesStore } from '../../features/favorites/favoritesStore';
import * as actions from '../../features/welcome/welcomeActions';
import { useSettingsStore } from '../../stores/settingsStore';

const MarkdownIcon = createFileTypeIcon('note.md');
const TextIcon = createFileTypeIcon('note.txt');
const BitableIcon = createFileTypeIcon('note.bitable');
const ExcalidrawIcon = createFileTypeIcon('note.excalidraw');
const MindmapIcon = createFileTypeIcon('note.mindmap');
const DrawioIcon = createFileTypeIcon('note.drawio');
const InfographicIcon = createFileTypeIcon('note.infographic');
const MermaidIcon = createFileTypeIcon('note.mmd');
const PlantUmlIcon = createFileTypeIcon('note.puml');
const JsonIcon = createFileTypeIcon('note.json');
const SqlIcon = createFileTypeIcon('note.sql');
const YamlIcon = createFileTypeIcon('note.yaml');
const XmlIcon = createFileTypeIcon('note.xml');

type Action = { label: string; icon: ComponentType<{ size?: number }>; run: () => unknown };
const primary: Action[] = [
  { label: '新建 NoteBoard 文档 (.nb)', icon: NoteBoardFileIcon, run: actions.newNativeDocument },
  { label: '新建 Markdown 笔记 (.md)', icon: MarkdownIcon, run: actions.newMarkdown },
  { label: '新建文本文档 (.txt)', icon: TextIcon, run: actions.newText },
  { label: '新建多维表格 (.bitable)', icon: BitableIcon, run: actions.newBitable },
  { label: '新建自由画板 (.excalidraw)', icon: ExcalidrawIcon, run: actions.newBoard },
  { label: '新建思维导图 (.mindmap)', icon: MindmapIcon, run: actions.newMindmap },
  { label: '文本对比', icon: GitCompare, run: actions.newTextDiff },
];
const formats: Action[] = [
  { label: 'Draw.io 架构图 (.drawio)', icon: DrawioIcon, run: actions.newDrawio },
  { label: '信息图 (.infographic)', icon: InfographicIcon, run: actions.newInfographic },
  { label: 'Mermaid 图表 (.mmd)', icon: MermaidIcon, run: actions.newMermaid },
  { label: 'PlantUML 建模 (.puml)', icon: PlantUmlIcon, run: actions.newPlantUml },
  { label: 'JSON 配置文件 (.json)', icon: JsonIcon, run: actions.newJson },
  { label: 'SQL 数据库脚本 (.sql)', icon: SqlIcon, run: actions.newSql },
  { label: 'YAML 配置文件 (.yaml)', icon: YamlIcon, run: actions.newYaml },
  { label: 'XML 标记文档 (.xml)', icon: XmlIcon, run: actions.newXml },
];
const openActions: Action[] = [
  { label: '打开文件 (Ctrl+O)', icon: FileText, run: actions.openFileDialog },
  { label: '打开文件夹 (Ctrl+Shift+O)', icon: FolderOpen, run: actions.openFolderDialog },
  { label: '打开收藏夹', icon: Star, run: () => useFavoritesStore.getState().openFavoritesModal() },
  { label: '打开暂存区', icon: Archive, run: actions.openStagingArea },
];
function Items({ items, onAction }: { items: Action[]; onAction?: (run: Action['run']) => void }) {
  return items.map(({ label, icon: Icon, run }) =>
    <Menu.Item key={label} className="titlebar-menu-item" onSelect={() => { onAction?.(run); void run(); }}>
      <Icon size={14} /><span>{label}</span>
    </Menu.Item>);
}

/** The titlebar positions this menu; tab scrolling never owns its lifecycle. */
export function NewDocumentMenu() {
  const pureMarkdown = useSettingsStore(state => state.settings.editor.pureMarkdown ?? false);
  const [open, setOpen] = useState(false);
  const documentOwnsFocus = useRef(false);
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
  return <div className="titlebar-new-document">
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content="新建或打开" side="bottom" disabled={open}>
        <Menu.Trigger asChild>
          <button type="button" className="titlebar-action" aria-label="新建或打开"
            onContextMenu={event => { event.preventDefault(); setOpen(true); }}><Plus size={16} /></button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal><Menu.Content className="titlebar-document-menu" align="start" sideOffset={5} collisionPadding={8}
        onCloseAutoFocus={event => { if (documentOwnsFocus.current) event.preventDefault(); documentOwnsFocus.current = false; }}>
        <Items items={pureMarkdown ? primary.filter(item => item.run !== actions.newNativeDocument) : primary}
          onAction={run => { documentOwnsFocus.current = run === actions.newNativeDocument || run === actions.newMarkdown; }} />
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
