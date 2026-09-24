// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { RefreshCw, ExternalLink } from 'lucide-react';
import * as ipc from '../../core/ipc/commands';
import { useUpdateStore } from '../../stores/updateStore';
import { APP_VERSION } from '../../core/version';

export function AboutPanel() {
  const { checking: checkingUpdate, checkForUpdates, hasUpdate, updateResult, checkError, openModal } = useUpdateStore();
  const handleCheckForUpdates = () => {
    checkForUpdates(false);
  };
  const handleOpenGithub = () => {
    ipc.openExternalUrl('https://github.com/ShallowDream724/NoteBoard').catch((err) => {
      console.error('无法打开 GitHub 链接:', err);
    });
  };
  return (<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18, padding: '24px 0' }}>
    <img src="/logo.ico" alt="NoteBoard Logo" width={56} height={56} />
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '4px 0' }}>NoteBoard</h2>
      <span style={{ fontSize: 12, color: 'var(--editor-text-muted)' }}>Windows 优雅桌面笔记 + 自由画板</span>
    </div>
    <p style={{ fontSize: 12, color: 'var(--editor-text-secondary)', maxWidth: 420, lineHeight: 1.6, margin: '4px 0' }}>
      采用 Rust Tauri v2 原生高性能底座与 TipTap / CodeMirror 6 / Excalidraw 多核驱动。
    </p>
    <div style={{ fontSize: 12, color: 'var(--editor-text-muted)' }}>
      版本 v{APP_VERSION} · GPL-3.0 License
    </div>

    {hasUpdate && <button type="button" className="nb-btn-secondary" onClick={openModal}
      style={{ color: 'var(--editor-accent)' }}>发现新版本 v{updateResult?.latestVersion} · 查看更新</button>}
    {!checkingUpdate && checkError && <p role="status" style={{ fontSize: 12, color: 'var(--editor-text-secondary)', maxWidth: 420, margin: 0 }}>{checkError}</p>}

    {/* 快捷操作：检测更新与 GitHub 仓库 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <button
        type="button"
        className="nb-btn-secondary"
        disabled={checkingUpdate}
        onClick={handleCheckForUpdates}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 18px',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 8,
          border: '1px solid var(--editor-border)',
          background: 'var(--editor-surface)',
          color: 'var(--accent-strong)',
          cursor: checkingUpdate ? 'not-allowed' : 'pointer',
          boxShadow: 'var(--shadow-sm)',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          if (!checkingUpdate) {
            e.currentTarget.style.background = 'var(--toolbar-hover)';
            e.currentTarget.style.borderColor = 'var(--editor-border-focus)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }
        }}
        onMouseLeave={(e) => {
          if (!checkingUpdate) {
            e.currentTarget.style.background = 'var(--editor-surface)';
            e.currentTarget.style.borderColor = 'var(--editor-border)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }
        }}
        onMouseDown={(e) => {
          if (!checkingUpdate) {
            e.currentTarget.style.background = 'var(--toolbar-active)';
            e.currentTarget.style.transform = 'translateY(0) scale(0.97)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }
        }}
        onMouseUp={(e) => {
          if (!checkingUpdate) {
            e.currentTarget.style.background = 'var(--toolbar-hover)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }
        }}
      >
        <RefreshCw size={15} className={checkingUpdate ? 'spin' : ''} style={checkingUpdate ? { animation: 'spin 1s linear infinite' } : undefined} />
        <span>{checkingUpdate ? '正在检查' : '检测更新'}</span>
      </button>

      <button
        type="button"
        className="nb-btn-secondary"
        onClick={handleOpenGithub}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 18px',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 8,
          border: '1px solid var(--editor-border)',
          background: 'var(--editor-surface)',
          color: 'var(--editor-text)',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-sm)',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--toolbar-hover)';
          e.currentTarget.style.borderColor = 'var(--editor-border-focus)';
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--editor-surface)';
          e.currentTarget.style.borderColor = 'var(--editor-border)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.background = 'var(--toolbar-active)';
          e.currentTarget.style.transform = 'translateY(0) scale(0.97)';
          e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.background = 'var(--toolbar-hover)';
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }}
      >
        <ExternalLink size={15} />
        <span>GitHub 仓库</span>
      </button>
    </div>
  </div>);
}
