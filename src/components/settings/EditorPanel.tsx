import { useSettingsStore } from '../../stores/settingsStore';
import { inputStyle, SettingRow, SettingsPanelHeading, SettingsSection } from './SettingsControls';

export function EditorPanel() {
  const { settings: { editor }, setEditor } = useSettingsStore();
  return <div className="nb-settings-panel">
    <SettingsPanelHeading title="编辑器" description="调整编辑习惯、Markdown 功能与代码显示。"/>
    <SettingsSection title="Markdown">
      <SettingRow label="默认视图" description="新打开 Markdown 文档时使用的模式。"><select value={editor.defaultViewMode} onChange={event => setEditor({ defaultViewMode: event.target.value as 'visual' | 'source' })} style={{ ...inputStyle, width: '10em' }}><option value="visual">可视化模式</option><option value="source">源码模式</option></select></SettingRow>
      <SettingRow label="纯 Markdown 偏好" description="默认新建 Markdown，并隐藏 NoteBoard 专属功能入口。"><input type="checkbox" checked={editor.pureMarkdown ?? false} onChange={event => setEditor({ pureMarkdown: event.target.checked })}/></SettingRow>
      <SettingRow label="选区工具栏位置"><select value={editor.selectionToolbarPosition ?? 'below'} onChange={event => setEditor({ selectionToolbarPosition: event.target.value as 'below' | 'above' })} style={{ ...inputStyle, width: '10em' }}><option value="below">选区下方</option><option value="above">选区上方</option></select></SettingRow>
      <SettingRow label="数学公式渲染"><input type="checkbox" checked={editor.enableMath} onChange={event => setEditor({ enableMath: event.target.checked })}/></SettingRow>
      <SettingRow label="Mermaid 图表渲染"><input type="checkbox" checked={editor.enableMermaid} onChange={event => setEditor({ enableMermaid: event.target.checked })}/></SettingRow>
      <SettingRow label="显示块把手" description="拖动段落或打开块菜单。"><input type="checkbox" checked={editor.enableBlockHandle} onChange={event => setEditor({ enableBlockHandle: event.target.checked })}/></SettingRow>
    </SettingsSection>
    <SettingsSection title="代码与纯文本显示">
      <SettingRow label="显示行号" description="显示代码行号与当前行高亮。"><input type="checkbox" checked={editor.showLineNumbers} onChange={event => setEditor({ showLineNumbers: event.target.checked })}/></SettingRow>
      <SettingRow label="自动折行" description="文本超出编辑区宽度时折行。"><input type="checkbox" checked={editor.softWrap} onChange={event => setEditor({ softWrap: event.target.checked })}/></SettingRow>
      <SettingRow label="显示空格与制表符" description="空格显示为圆点，制表符显示为箭头。"><input type="checkbox" checked={editor.showWhitespace ?? false} onChange={event => setEditor({ showWhitespace: event.target.checked })}/></SettingRow>
      <SettingRow label="显示换行符" description="在行末显示 ↵ 标记。"><input type="checkbox" checked={editor.showLineEndings ?? false} onChange={event => setEditor({ showLineEndings: event.target.checked })}/></SettingRow>
      <SettingRow label="显示缩进导线"><input type="checkbox" checked={editor.showIndentGuides} onChange={event => setEditor({ showIndentGuides: event.target.checked })}/></SettingRow>
    </SettingsSection>
    <SettingsSection title="缩进">
      <SettingRow label="Tab 宽度" description="每个 Tab 对应的空格数量。"><input type="number" min="1" max="8" value={editor.tabSize} onChange={event => setEditor({ tabSize: Math.max(1, Math.min(8, parseInt(event.target.value, 10) || 2)) })} style={{ ...inputStyle, width: '5em', textAlign: 'center' }}/></SettingRow>
      <SettingRow label="空格代替 Tab"><input type="checkbox" checked={editor.insertSpaces} onChange={event => setEditor({ insertSpaces: event.target.checked })}/></SettingRow>
    </SettingsSection>
  </div>;
}
