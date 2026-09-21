// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { FileText, FileCode } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { inputStyle } from './SettingsControls';

export function EditorPanel() {
  const { settings, setEditor } = useSettingsStore();
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>编辑器与代码设置</h3>
      <p style={{ fontSize: 12, color: 'var(--editor-text-muted)', margin: 0 }}>
        配置纯文本、SQL、JSON 等代码编辑器的显示效果及 Markdown 增强选项。
      </p>
    </div>

    {/* ── 3.1 代码与纯文本展示 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
        <FileCode size={15} color="var(--accent-strong)" />
        <span>代码与纯文本展示 (.txt / .sql / .json / .yaml 等)</span>
      </div>

      {/* 显示空格（显示为点） */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>显示空格（点）</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>将文本中的空格显示为轻柔圆点标记，制表符显示为箭头</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.showWhitespace ?? false}
          onChange={(e) => setEditor({ showWhitespace: e.target.checked })}
        />
      </label>

      {/* 显示换行符（↵） */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>显示换行符号 (↵)</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>在各行末尾显示 ↵ 换行指示符号</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.showLineEndings ?? false}
          onChange={(e) => setEditor({ showLineEndings: e.target.checked })}
        />
      </label>

      {/* 显示行号 */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>显示行号</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>在左侧边栏展示代码行号及活动行高亮</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.showLineNumbers}
          onChange={(e) => setEditor({ showLineNumbers: e.target.checked })}
        />
      </label>

      {/* 软换行 */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>软换行 (自动折行)</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>超出编辑器可视宽度时自动折行，避免横向滚动</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.softWrap}
          onChange={(e) => setEditor({ softWrap: e.target.checked })}
        />
      </label>

      {/* 缩进导线 */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>缩进参考导线</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>在代码层级之间显示垂直虚线导线</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.showIndentGuides}
          onChange={(e) => setEditor({ showIndentGuides: e.target.checked })}
        />
      </label>
    </div>

    {/* ── 3.2 缩进与编辑参数 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
        <FileText size={15} color="var(--accent-strong)" />
        <span>缩进与通用选项</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
        <div>
          <div>Tab 缩进宽度</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>每个 Tab 对应的空格数量</div>
        </div>
        <input
          type="number"
          min="1"
          max="8"
          value={settings.editor.tabSize}
          onChange={(e) => setEditor({ tabSize: parseInt(e.target.value, 10) || 2 })}
          style={{ ...inputStyle, width: 60, textAlign: 'center' }}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
        <div>
          <div>空格代替 Tab</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>按下 Tab 键时插入对应数量的空格</div>
        </div>
        <input
          type="checkbox"
          checked={settings.editor.insertSpaces}
          onChange={(e) => setEditor({ insertSpaces: e.target.checked })}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
        <div>
          <div>Markdown 默认视图模式</div>
          <div style={{ fontSize: 11, color: 'var(--editor-text-muted)' }}>新打开 Markdown 文档时的初始模式</div>
        </div>
        <select
          value={settings.editor.defaultViewMode}
          onChange={(e) => setEditor({ defaultViewMode: e.target.value as 'visual' | 'source' })}
          style={{ ...inputStyle, width: 110 }}
        >
          <option value="visual">可视化模式</option>
          <option value="source">源码模式</option>
        </select>
      </div>
    </div>

    {/* ── 3.3 Markdown 渲染增强 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent-strong)' }}>
        Markdown 增强功能
      </div>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
        <span>选区工具栏位置</span>
        <select value={settings.editor.selectionToolbarPosition ?? 'below'}
          onChange={event => setEditor({ selectionToolbarPosition: event.target.value as 'below' | 'above' })}
          style={{ ...inputStyle, width: 110 }}>
          <option value="below">选区下方</option><option value="above">选区上方</option>
        </select>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
        <span>LaTeX 数学公式渲染 (KaTeX)</span>
        <input
          type="checkbox"
          checked={settings.editor.enableMath}
          onChange={(e) => setEditor({ enableMath: e.target.checked })}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
        <span>Mermaid 图表实时渲染</span>
        <input
          type="checkbox"
          checked={settings.editor.enableMermaid}
          onChange={(e) => setEditor({ enableMermaid: e.target.checked })}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '2px 0' }}>
        <span>悬浮块把手 (拖拽与菜单)</span>
        <input
          type="checkbox"
          checked={settings.editor.enableBlockHandle}
          onChange={(e) => setEditor({ enableBlockHandle: e.target.checked })}
        />
      </label>
    </div>
  </div>);
}
