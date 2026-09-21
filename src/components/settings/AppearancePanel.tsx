// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { useSettingsStore } from '../../stores/settingsStore';
import { THEMES } from '../../core/theme/themes';
import { ThemeCard } from './SettingsControls';

export function AppearancePanel() {
  const { settings, resolvedTheme, setThemeMode } = useSettingsStore();
  const currentThemeMode = settings.appearance.themeMode;
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>主题配色方案</h3>
      <p style={{ fontSize: 12, color: 'var(--editor-text-muted)', margin: 0 }}>
        精心设计的经典配色，针对 Markdown 代码块与行内代码深度调优。
      </p>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      {/* 晨光 */}
      <ThemeCard
        title="晨光"
        desc="清新明亮 · 晨曦蓝调"
        bg="#ffffff"
        accent="#3b82f6"
        codeBg="#f8fafc"
        codeColor="#1d4ed8"
        selected={currentThemeMode === 'chen-guang'}
        onClick={() => setThemeMode('chen-guang')}
      />
      {/* 琥珀 */}
      <ThemeCard
        title="琥珀"
        desc="温暖纸质 · 琥珀赤陶"
        bg="#FAF9F5"
        accent="#D97757"
        codeBg="#EFEEE9"
        codeColor="#C2410C"
        selected={currentThemeMode === 'hu-po'}
        onClick={() => setThemeMode('hu-po')}
      />
      {/* 墨夜 */}
      <ThemeCard
        title="墨夜"
        desc="夜幕深邃 · 护眼暗色"
        bg="#0f172a"
        accent="#60a5fa"
        codeBg="#1e293b"
        codeColor="#93c5fd"
        selected={currentThemeMode === 'mo-ye'}
        onClick={() => setThemeMode('mo-ye')}
      />
      {/* 跟随系统 */}
      <ThemeCard
        title="跟随系统"
        desc={`当前生效: ${THEMES[resolvedTheme]?.displayName ?? resolvedTheme}`}
        bg="linear-gradient(135deg, #ffffff 50%, #0f172a 50%)"
        accent="#8b5cf6"
        codeBg="#f1f5f9"
        codeColor="#475569"
        selected={currentThemeMode === 'system'}
        onClick={() => setThemeMode('system')}
      />
    </div>
  </div>);
}
