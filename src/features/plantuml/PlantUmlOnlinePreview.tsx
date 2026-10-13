export function PlantUmlOnlinePreview({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--editor-text-muted, #64748b)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <span>{enabled ? '在线预览已启用：本视图的图表源码会发送至 plantuml.com。' : '在线预览会将本视图的图表源码发送至 plantuml.com。'}</span>
    <button type="button" className="nb-editor-toolbar-btn" onClick={() => onChange(!enabled)}>{enabled ? '关闭在线预览' : '启用在线预览'}</button>
  </div>;
}
