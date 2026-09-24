import { useSettingsStore } from '../../stores/settingsStore';
import { THEMES } from '../../core/theme/themes';
import { ThemeCard } from './ThemeCard';
import './appearance.css';

export function AppearancePanel() {
  const currentThemeMode = useSettingsStore(s => s.settings.appearance.themeMode);
  const resolvedTheme = useSettingsStore(s => s.resolvedTheme);
  const setThemeMode = useSettingsStore(s => s.setThemeMode);
  return <section className="appearance-panel">
    <header><h3>外观主题</h3><p>选择适合你的阅读与书写配色。</p></header>
    <div className="theme-grid" role="group" aria-label="外观主题">
      {Object.values(THEMES).map(theme => <ThemeCard key={theme.id} theme={theme}
        title={theme.displayName} description={theme.scheme === 'dark' ? '深蓝夜色' : theme.id === 'hu-po' ? '暖纸与赤陶' : '明亮蓝调'}
        selected={currentThemeMode === theme.id} onSelect={() => { void setThemeMode(theme.id); }} />)}
      <ThemeCard theme={THEMES[resolvedTheme]} system title="跟随系统"
        description={`当前为${THEMES[resolvedTheme].displayName}`} selected={currentThemeMode === 'system'}
        onSelect={() => { void setThemeMode('system'); }} />
    </div>
  </section>;
}
