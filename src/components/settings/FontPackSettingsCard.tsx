// NoteBoard 设置页字体包管理卡片：下载、修复、离线导入与明确删除。

import { ChevronDown, Download, PackageCheck, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { resolveSystemFontFallbackPatch } from '../../app/fontPack';
import * as ipc from '../../core/ipc/commands';
import { useFontPackStore } from '../../stores/fontPackStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../../stores/toastStore';
import './fontPackSettings.css';

const formatBytes = (value?: number | null) => {
  if (!value || !Number.isFinite(value)) return '—';
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
};

/** 设置页长期保留管理入口，用户拒绝首次下载后仍可随时重新启用应用字体。 */
export function FontPackSettingsCard() {
  const { settings, setTypography, applyRecommendedFonts } = useSettingsStore();
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const {
    status,
    action,
    progress,
    error,
    download,
    importArchive,
    remove,
    clearError,
  } = useFontPackStore();
  const busy = Boolean(action) || applying;
  const ready = status?.state === 'ready';
  const usingRecommended = settings.typography.monoFontFamily === 'JetBrains Mono'
    && settings.typography.monoFontFamilyZh === 'Maple Mono Normal NF CN';
  const totalBytes = progress?.totalBytes ?? status?.downloadSizeBytes;
  const percent = progress?.percent
    ?? (progress && totalBytes
      ? Math.round((progress.downloadedBytes / totalBytes) * 100)
      : 0);
  const statusText = ready
    ? `已安装 v${status.version}`
    : status?.state === 'invalid'
      ? '需要修复'
      : status?.state === 'verifying'
        ? '正在校验'
      : '尚未安装';

  const handleDownload = async () => {
    const result = await download();
    if (result?.state === 'ready') { setExpanded(false); showToast('字体包已下载，字体设置已更新', 'success'); }
  };

  const handleImport = async () => {
    clearError();
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'NoteBoard 字体包', extensions: ['zip'] }],
    });
    if (typeof selected !== 'string') return;
    const result = await importArchive(selected);
    if (result?.state === 'ready') { setExpanded(false); showToast('字体包已导入，字体设置已更新', 'success'); }
  };

  const handleUseRecommended = async () => {
    setApplying(true);
    try {
      await applyRecommendedFonts(settings.typography);
      showToast('代码与纯文本已使用推荐字体', 'success');
    } catch (operationError) {
      showToast(`字体设置保存失败：${String(operationError)}`, 'error');
    } finally { setApplying(false); }
  };

  const handleRemove = async () => {
    clearError();
    try {
      // 先把依赖应用字体的字段保存为真实系统字体，再删除文件，避免当前窗口出现无效配置。
      const installed = await ipc.listSystemFonts();
      const patch = resolveSystemFontFallbackPatch(
        settings.typography,
        installed.map((font) => font.family),
      );
      if (Object.keys(patch).length) await setTypography(patch);
      const result = await remove();
      if (result?.state === 'missing') showToast('应用字体包已删除，当前使用系统字体', 'success');
    } catch (operationError) {
      showToast(`字体包删除失败：${String(operationError)}`, 'error', 5000);
    }
  };

  return (
    <div className={`nb-font-pack-settings-card${ready ? ' is-installed' : ''}`}>
      {ready ? (
        <div className="nb-font-pack-installed-row">
          <PackageCheck size={16} aria-hidden="true" />
          <div className="nb-font-pack-installed-copy">
            <span>增强字体包已安装</span>
            <span>{usingRecommended ? '代码与纯文本正在使用推荐字体' : 'JetBrains Mono · Maple Mono 可用'}</span>
          </div>
          {!usingRecommended ? <button className="nb-btn-secondary" type="button" disabled={busy} onClick={handleUseRecommended}>{applying ? '正在应用' : '使用推荐字体'}</button> : null}
          <button className="nb-font-pack-manage" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            管理<ChevronDown size={14} />
          </button>
        </div>
      ) : null}
      {(!ready || expanded) ? <>
      <div className="nb-font-pack-settings-heading">
        <div>
          <div className="nb-font-pack-settings-title">
            <PackageCheck size={16} />
            应用增强字体包
          </div>
          <p>代码与纯文本使用 JetBrains Mono + Maple Mono，仅在 NoteBoard 内启用。已下载字体随版本升级保留。</p>
        </div>
        <span className={`nb-font-pack-status is-${status?.state ?? 'missing'}`}>{statusText}</span>
      </div>

      <div className="nb-font-pack-settings-meta">
        <span>安装后约 {formatBytes(status?.installedSizeBytes)}</span>
        <span>在线下载约 {formatBytes(status?.downloadSizeBytes)}</span>
      </div>

      {action === 'download' ? (
        <div className="nb-font-pack-progress" aria-live="polite">
          <div className="nb-font-pack-progress-copy">
            <span>正在下载并校验字体包</span>
            <span>{Math.min(100, Math.max(0, percent))}%</span>
          </div>
          <div className="nb-font-pack-progress-track">
            <div
              className="nb-font-pack-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
          <span className="nb-font-pack-muted">
            {formatBytes(progress?.downloadedBytes)} / {formatBytes(totalBytes)}
          </span>
        </div>
      ) : null}

      <div className="nb-font-pack-settings-actions">
        <button className="nb-btn-secondary" disabled={busy} onClick={handleImport} type="button">
          <Upload size={15} />
          {action === 'import' ? '正在导入' : '导入并使用'}
        </button>
        {ready ? (
          <button className="nb-font-pack-remove-button" disabled={busy} onClick={handleRemove} type="button">
            <Trash2 size={15} />
            {action === 'remove' ? '正在删除' : '删除字体包'}
          </button>
        ) : (
          <button className="nb-btn-primary" disabled={busy} onClick={handleDownload} type="button">
            <Download size={15} />
            {action === 'download' ? '正在下载' : status?.state === 'invalid' ? '修复并使用' : '下载并使用'}
          </button>
        )}
      </div>
      </> : null}
      {error ? <p className="nb-font-pack-error" role="alert">{error}</p> : null}
    </div>
  );
}
