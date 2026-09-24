// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { FileText, FileCode, Folder, LayoutTemplate, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { showToast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { contentWidthToPercent, CONTENT_WIDTH_PERCENT_MAP } from '../../core/theme/applyTheme';
import { FontSelect } from './FontSelect';
import { FontPackSettingsCard } from './FontPackSettingsCard';
import { formRowStyle, labelStyle } from './SettingsControls';

export function TypographyPanel() {
  const { settings, setTypography, resetTypography } = useSettingsStore();
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    try { await resetTypography(); showToast('排版与字体已恢复默认', 'success'); }
    catch (error) { showToast(`恢复失败：${String(error)}`, 'error'); }
    finally { setResetting(false); }
  };
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div>
      <h3 style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 14 / 13)', fontWeight: 600, marginBottom: 4 }}>排版参数自定义</h3>
      <p style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)', margin: 0 }}>
        独立配置软件界面、Markdown 正文、代码与纯文本以及文件树的排版与版心宽度参数。
      </p>
    </div>

    {/* 应用字体包独立于安装包，设置页提供下载、修复、导入和删除的长期入口。 */}
    <div className="nb-settings-reset-row"><button className="nb-btn-secondary" type="button" disabled={resetting} onClick={() => void reset()}><RotateCcw size={14}/>{resetting ? '正在恢复…' : '全部恢复默认'}</button></div>
    <FontPackSettingsCard />

    {/* ── 2.1 软件界面 UI 排版 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div className="nb-settings-section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
          <LayoutTemplate size={15} color="var(--accent-strong)" />
          <span>软件界面 UI 排版 (全局界面 / 弹窗 / 提示 / 菜单)</span>
        </div>
      </div>
      <p className="nb-settings-section-description">调整标题栏、标签页、设置和菜单的字体与字号。</p>

      {/* 界面 UI 中西双字体配置 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>界面西文字体 (英文/数字)</label>
          <FontSelect
            label="界面西文字体"
            value={settings.typography.uiFontFamily ?? ''}
            filterType="en"
            placeholder="系统默认西文字体 (如: Segoe UI, Inter)"
            onChange={(font) => setTypography({ uiFontFamily: font })}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>界面中文字体 (汉字/全角)</label>
          <FontSelect
            label="界面中文字体"
            value={settings.typography.uiFontFamilyZh ?? ''}
            filterType="zh"
            placeholder="系统默认中文字体 (如: Microsoft YaHei UI, 苹方)"
            onChange={(font) => setTypography({ uiFontFamilyZh: font })}
          />
        </div>
      </div>

      {/* 界面 UI 字号 */}
      <div style={formRowStyle}>
        <label style={labelStyle}>界面 UI 基础字号 ({settings.typography.uiFontSize ?? 13}px)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min="12"
            max="18"
            step="1"
            value={settings.typography.uiFontSize ?? 13}
            onChange={(e) => setTypography({ uiFontSize: parseInt(e.target.value, 10) })}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {settings.typography.uiFontSize ?? 13}px
          </span>
        </div>
      </div>
    </div>

    {/* ── 2.2 Markdown 正文排版 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
        <FileText size={15} color="var(--accent-strong)" />
        <span>Markdown 正文排版</span>
      </div>

      {/* 正文中西双字体配置 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>正文西文字体 (英文/数字)</label>
          <FontSelect
            label="正文西文字体"
            value={settings.typography.contentFontFamily}
            filterType="en"
            placeholder="系统默认西文字体 (如: Georgia, Inter, Segoe UI)"
            onChange={(font) => setTypography({ contentFontFamily: font })}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>正文中文字体 (汉字/全角)</label>
          <FontSelect
            label="正文中文字体"
            value={settings.typography.contentFontFamilyZh ?? ''}
            filterType="zh"
            placeholder="系统默认中文字体 (如: 微软雅黑, 霞鹜文楷, 楷体)"
            onChange={(font) => setTypography({ contentFontFamilyZh: font })}
          />
        </div>
      </div>

      {/* 正文字号与行高 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>正文字号 ({settings.typography.contentFontSize}px)</label>
          <input
            type="range"
            min="12"
            max="26"
            step="1"
            value={settings.typography.contentFontSize}
            onChange={(e) => setTypography({ contentFontSize: parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>正文行高 ({settings.typography.contentLineHeight})</label>
          <input
            type="range"
            min="1.3"
            max="2.4"
            step="0.1"
            value={settings.typography.contentLineHeight}
            onChange={(e) => setTypography({ contentLineHeight: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Markdown 编辑区最大宽度 */}
      <div style={formRowStyle}>
        <label style={labelStyle}>Markdown 编辑区最大宽度 (默认宽屏 92%)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {/* 预设档位按钮 */}
          <div className="nb-settings-presets">
            {(['narrow', 'standard', 'wide', 'full'] as const).map((w) => {
              const labels: Record<string, string> = {
                narrow: '窄 (65%)',
                standard: '标准 (80%)',
                wide: '宽屏 (92%)',
                full: '全宽 (100%)',
              };
              const currentMdWidth = settings.typography.contentWidth ?? 'wide';
              const isSelected =
                currentMdWidth === w ||
                contentWidthToPercent(currentMdWidth) === CONTENT_WIDTH_PERCENT_MAP[w];
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setTypography({ contentWidth: w })}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '1px solid var(--accent-strong)' : '1px solid var(--editor-border)',
                    background: isSelected ? 'var(--editor-selection)' : 'var(--editor-bg)',
                    color: 'var(--editor-text)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--toolbar-hover)';
                      e.currentTarget.style.borderColor = 'var(--editor-border-focus)';
                    }
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--editor-bg)';
                      e.currentTarget.style.borderColor = 'var(--editor-border)';
                    }
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'translateY(0) scale(0.96)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                >
                  {labels[w]}
                </button>
              );
            })}
          </div>

          {/* 滑动条自定义宽度调节 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <input
              type="range"
              min="40"
              max="100"
              step="1"
              value={contentWidthToPercent(settings.typography.contentWidth ?? 'wide')}
              onChange={(e) => {
                const val = `${e.target.value}%`;
                setTypography({ contentWidth: val });
              }}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)', minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {contentWidthToPercent(settings.typography.contentWidth ?? 'wide')}%
            </span>
          </div>
        </div>
      </div>
    </div>

    {/* ── 2.3 代码与纯文本排版 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div className="nb-settings-section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
          <FileCode size={15} color="var(--accent-strong)" />
          <span>代码与纯文本排版 (.sql / .txt / .json / 代码块)</span>
        </div>
      </div>
      <p className="nb-settings-section-description">在代码或纯文本编辑区按住 Ctrl 滚动鼠标，也可以调整代码字号。</p>

      {/* 代码等宽中西双字体配置 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>代码西文等宽字体</label>
          <FontSelect
            label="代码西文字体"
            value={settings.typography.monoFontFamily}
            placeholder="Consolas, Cascadia Code, JetBrains Mono"
            filterType="mono"
            isMonospaceOnly={true}
            onChange={(font) => setTypography({ monoFontFamily: font })}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>代码中文等宽/中文字体</label>
          <FontSelect
            label="代码中文字体"
            value={settings.typography.monoFontFamilyZh ?? ''}
            placeholder="Microsoft YaHei UI, 微软雅黑, 等宽中文"
            filterType="zh"
            onChange={(font) => setTypography({ monoFontFamilyZh: font })}
          />
        </div>
      </div>

      {/* 代码字号与行高 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>代码字号 ({settings.typography.monoFontSize ?? 14}px)</label>
          <input
            type="range"
            min="10"
            max="24"
            step="1"
            value={settings.typography.monoFontSize ?? 14}
            onChange={(e) => setTypography({ monoFontSize: parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>代码行高 ({settings.typography.monoLineHeight ?? 1.5})</label>
          <input
            type="range"
            min="1.2"
            max="2.2"
            step="0.1"
            value={settings.typography.monoLineHeight ?? 1.5}
            onChange={(e) => setTypography({ monoLineHeight: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* 代码与纯文本编辑区最大宽度 */}
      <div style={formRowStyle}>
        <label style={labelStyle}>代码 / 纯文本编辑区最大宽度 (默认全宽 100%)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {/* 预设档位按钮 */}
          <div className="nb-settings-presets">
            {(['narrow', 'standard', 'wide', 'full'] as const).map((w) => {
              const labels: Record<string, string> = {
                narrow: '窄 (65%)',
                standard: '标准 (80%)',
                wide: '宽屏 (92%)',
                full: '全宽 (100%)',
              };
              const currentMonoWidth = settings.typography.monoContentWidth ?? 'full';
              const isSelected =
                currentMonoWidth === w ||
                contentWidthToPercent(currentMonoWidth) === CONTENT_WIDTH_PERCENT_MAP[w];
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setTypography({ monoContentWidth: w })}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '1px solid var(--accent-strong)' : '1px solid var(--editor-border)',
                    background: isSelected ? 'var(--editor-selection)' : 'var(--editor-bg)',
                    color: 'var(--editor-text)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--toolbar-hover)';
                      e.currentTarget.style.borderColor = 'var(--editor-border-focus)';
                    }
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--editor-bg)';
                      e.currentTarget.style.borderColor = 'var(--editor-border)';
                    }
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'translateY(0) scale(0.96)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                >
                  {labels[w]}
                </button>
              );
            })}
          </div>

          {/* 滑动条自定义宽度调节 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <input
              type="range"
              min="40"
              max="100"
              step="1"
              value={contentWidthToPercent(settings.typography.monoContentWidth ?? 'full')}
              onChange={(e) => {
                const val = `${e.target.value}%`;
                setTypography({ monoContentWidth: val });
              }}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)', minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {contentWidthToPercent(settings.typography.monoContentWidth ?? 'full')}%
            </span>
          </div>
        </div>
      </div>
    </div>

    {/* ── 2.5 文件树排版（资源管理器） ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div className="nb-settings-section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
          <Folder size={15} color="var(--accent-strong)" />
          <span>文件树排版 (左侧资源管理器)</span>
        </div>
      </div>

      {/* 文件树中西双字体配置 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>文件树西文字体</label>
          <FontSelect
            label="文件树西文字体"
            value={settings.typography.explorerFontFamily ?? ''}
            filterType="en"
            placeholder="系统界面默认 (如: Segoe UI, Arial)"
            onChange={(font) => setTypography({ explorerFontFamily: font })}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>文件树中文字体</label>
          <FontSelect
            label="文件树中文字体"
            value={settings.typography.explorerFontFamilyZh ?? ''}
            filterType="zh"
            placeholder="系统界面默认 (如: Microsoft YaHei UI, 苹方)"
            onChange={(font) => setTypography({ explorerFontFamilyZh: font })}
          />
        </div>
      </div>

      {/* 文件树字号与行高 */}
      <div className="nb-settings-grid">
        <div style={formRowStyle}>
          <label style={labelStyle}>文件树字号 ({settings.typography.explorerFontSize ?? 13}px)</label>
          <input
            type="range"
            min="11"
            max="18"
            step="1"
            value={settings.typography.explorerFontSize ?? 13}
            onChange={(e) => setTypography({ explorerFontSize: parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </div>
        <div style={formRowStyle}>
          <label style={labelStyle}>目录条目行高 ({settings.typography.explorerLineHeight ?? 24}px)</label>
          <input
            type="range"
            min="20"
            max="36"
            step="1"
            value={settings.typography.explorerLineHeight ?? 24}
            onChange={(e) => setTypography({ explorerLineHeight: parseInt(e.target.value, 10) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>

    {/* ── 2.6 实时排版效果预览 ── */}
    <div>
      <label style={{ ...labelStyle, marginBottom: 8, display: 'block' }}>实时排版预览</label>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '18px 20px',
          background: 'var(--editor-surface)',
          border: '1px solid var(--editor-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {/* 软件界面 UI 效果预览 */}
        <div>
          <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)' }}>
            软件界面 UI 与提示效果 (中英文混合测试: NoteBoard 2026 Ready)：
          </p>
          <div className="nb-settings-preview-row"
            style={{
              fontFamily: 'var(--ui-font-family)',
              fontSize: settings.typography.uiFontSize ?? 13,
              padding: '12px 16px',
              background: 'var(--editor-bg)',
              border: '1px solid var(--editor-border)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>NoteBoard 界面</span>
              <span style={{ fontSize: '0.88em', color: 'var(--editor-text-muted)' }}>提示信息：文档已就绪 (File Ready)</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ padding: '3px 8px', background: 'var(--editor-selection)', color: 'var(--accent-strong)', borderRadius: 'var(--radius-sm)', fontSize: '0.88em', fontWeight: 500 }}>
                Active Tab 标签
              </span>
              <span style={{ padding: '3px 8px', background: 'var(--editor-surface)', border: '1px solid var(--editor-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.88em' }}>
                Action 按钮
              </span>
            </div>
          </div>
        </div>

        {/* Markdown 正文预览 */}
        <div
          style={{
            fontFamily: 'var(--content-font-family)',
            fontSize: settings.typography.contentFontSize,
            lineHeight: settings.typography.contentLineHeight,
          }}
        >
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.9em', color: 'var(--editor-text-muted)' }}>
            Markdown 正文效果：
          </p>
          <p style={{ margin: 0 }}>
            这是中英文正文排版效果（Typography Test: Quick Brown Fox 123），包含 <strong>加粗文本 Bold</strong>、<em>斜体 Italic</em> 与 <code style={{
              background: 'var(--code-inline-bg)',
              color: 'var(--code-inline-text)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--mono-font-family)',
              fontSize: '0.88em',
              border: '1px solid var(--editor-border)',
            }}>const note = "NoteBoard 2026";</code> 行内代码。
          </p>
        </div>

        {/* 代码文件预览 */}
        <div>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)' }}>
            SQL / 代码 / 纯文本效果：
          </p>
          <pre className="nb-typography-code-preview" style={{
            margin: 0,
            padding: '10px 14px',
            background: 'var(--code-block-bg)',
            border: '1px solid var(--editor-border)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--mono-font-family)',
            fontSize: settings.typography.monoFontSize ?? 14,
            lineHeight: settings.typography.monoLineHeight ?? 1.5,
            color: 'var(--code-block-text)',
          }}>
            <code>{`-- 查询笔记表（中西文代码混排测试）\nSELECT id, title, created_at\nFROM notes\nWHERE status = 'active' -- 仅查询有效笔记;`}</code>
          </pre>
        </div>

        {/* 文件树条目预览 */}
        <div>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)' }}>
            文件树目录条目效果：
          </p>
          <div
            style={{
              background: 'var(--explorer-bg)',
              border: '1px solid var(--editor-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: settings.typography.explorerLineHeight ?? 24,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 12,
                paddingRight: 8,
                background: 'var(--explorer-active)',
                borderLeft: '2px solid var(--accent-strong)',
                color: 'var(--explorer-text)',
                fontSize: settings.typography.explorerFontSize ?? 13,
                fontFamily: 'var(--explorer-font-family)',
              }}
            >
              <FileText size={14} color="var(--editor-accent)" />
              <span>01_快速入门指南 (Guide.md)</span>
            </div>
            <div
              style={{
                height: settings.typography.explorerLineHeight ?? 24,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 12,
                paddingRight: 8,
                color: 'var(--explorer-text)',
                fontSize: settings.typography.explorerFontSize ?? 13,
                fontFamily: 'var(--explorer-font-family)',
              }}
            >
              <FileCode size={14} color="var(--editor-accent)" />
              <span>query_report.sql</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>);
}

