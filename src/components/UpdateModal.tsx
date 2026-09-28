import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Download, ExternalLink, X, RefreshCw, CheckCircle2, AlertCircle, ArrowUpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { renderUpdateReleaseNotes } from './updateReleaseNotes';
import type { UpdateCheckResult, UpdateDownloadProgress } from '../core/ipc/types';
import * as ipc from '../core/ipc/commands';
import './updateModal.css';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: UpdateCheckResult | null;
  checkError?: string | null;
  checking?: boolean;
  onRecheck?: () => void;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatReleaseDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function UpdateModal({ isOpen, onClose, result, checkError, checking = false, onRecheck }: UpdateModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const releaseHtml = useMemo(() => renderUpdateReleaseNotes(result?.releaseBody?.trim() ?? ''), [result?.releaseBody]);

  useEffect(() => {
    if (!isOpen) {
      setDownloading(false);
      setDownloadProgress(null);
      setInstallError(null);
      setLinkError(null);
      return;
    }
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    listen<UpdateDownloadProgress>('noteboard-update-download-progress', event => {
      if (!disposed) setDownloadProgress(event.payload);
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn;
    }).catch(error => { if (!disposed) setInstallError(`无法读取下载进度：${String(error)}`); });
    return () => { disposed = true; unlisten?.(); };
  }, [isOpen]);

  const progressPercent = useMemo(() => {
    if (downloadProgress?.percent !== undefined) return Math.min(100, Math.max(0, downloadProgress.percent));
    if (downloadProgress?.totalBytes && downloadProgress.totalBytes > 0) {
      return Math.min(100, Math.max(0, Math.round(downloadProgress.downloadedBytes / downloadProgress.totalBytes * 100)));
    }
    return 0;
  }, [downloadProgress]);

  const handleDownloadAndInstall = async () => {
    if (!result?.installerDownloadUrl || !result?.installerAssetName) return;
    try {
      setDownloading(true);
      setInstallError(null);
      await ipc.downloadAndInstallUpdate({
        downloadUrl: result.installerDownloadUrl,
        assetName: result.installerAssetName,
        installerSize: result.installerSize,
      });
      onClose();
    } catch (err: unknown) {
      setInstallError(`安装包下载或启动失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenUrl = (url: string) => {
    setLinkError(null);
    void ipc.openExternalUrl(url).catch(() => setLinkError('无法打开链接，请稍后重试。'));
  };
  const handleReleaseLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) handleOpenUrl(href);
  };

  if (!isOpen) return null;
  const showDetail = Boolean(result?.updateAvailable && !checkError && !checking);
  const publishedDate = formatReleaseDate(result?.publishedAt);
  const canInstall = Boolean(result?.installerDownloadUrl && result.installerAssetName);

  return <Dialog.Root open={isOpen} onOpenChange={open => { if (!open && !downloading) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="update-modal-overlay">
        <Dialog.Content className="update-modal" data-shortcuts-suspended aria-describedby={undefined}
          onEscapeKeyDown={event => { if (downloading) event.preventDefault(); }}
          onPointerDownOutside={event => { if (downloading) event.preventDefault(); }}>
          <header className="update-modal-header">
            <Dialog.Title className="update-modal-title">{showDetail ? '更新内容' : '软件更新'}</Dialog.Title>
            <Tooltip content="关闭" shortcut="Esc" side="bottom" sideOffset={4}>
              <button type="button" className="update-modal-close" disabled={downloading} onClick={onClose} aria-label="关闭更新弹窗"><X size={16} /></button>
            </Tooltip>
          </header>
          <div className="update-modal-body">
            {checking && <div className="update-modal-state" role="status">
              <RefreshCw size={25} className="update-modal-spinner" aria-hidden="true" />
              <h3>正在检查更新</h3><p>正在连接 GitHub 获取最新版本…</p>
            </div>}
            {!checking && checkError && <div className="update-modal-state update-modal-state-error" role="alert">
              <AlertCircle size={25} aria-hidden="true" /><h3>暂时无法检查更新</h3><p>{checkError}</p>
            </div>}
            {!checking && !checkError && result && !result.updateAvailable && <div className="update-modal-state" role="status">
              <CheckCircle2 size={28} aria-hidden="true" />
              <h3>{result.latestVersion ? '已是最新版本' : '尚未发布正式版本'}</h3>
              <p>{result.latestVersion ? `当前版本 v${result.currentVersion}` : `继续使用当前版本 v${result.currentVersion}`}</p>
            </div>}
            {showDetail && result && <>
              <div className="update-modal-release">
                <div className="update-modal-version"><ArrowUpCircle size={21} aria-hidden="true" /><h2>NoteBoard v{result.latestVersion}</h2></div>
                <div className="update-modal-metadata"><span>当前 v{result.currentVersion}</span>{publishedDate && <span>{publishedDate}</span>}{result.installerSize ? <span>{formatBytes(result.installerSize)}</span> : null}</div>
              </div>
              {releaseHtml ? <div className="update-release-notes" onClick={handleReleaseLink} onAuxClick={handleReleaseLink} dangerouslySetInnerHTML={{ __html: releaseHtml }} />
                : <p className="update-modal-empty">本次更新暂无详细说明。</p>}
            </>}
          </div>
          <footer className="update-modal-footer">
            {(installError || linkError) && <p role="alert" className="update-modal-error"><AlertCircle size={15} aria-hidden="true" /><span>{installError || linkError}</span></p>}
            {downloading && <div className="update-modal-progress" role="status">
              <div className="update-modal-progress-label"><span>正在下载安装包</span><span>{downloadProgress ? `${formatBytes(downloadProgress.downloadedBytes)} / ${formatBytes(downloadProgress.totalBytes)} · ${progressPercent}%` : '准备下载…'}</span></div>
              <div className="update-modal-progress-track" role="progressbar" aria-label="安装包下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><div style={{ width: `${progressPercent}%` }} /></div>
            </div>}
            {showDetail && !canInstall && <p className="update-modal-empty">此版本暂无可用安装包，可前往发布页查看。</p>}
            <div className="update-modal-actions">
              {result?.releaseUrl && <button type="button" className="update-modal-link" disabled={downloading} onClick={() => handleOpenUrl(result.releaseUrl)}><ExternalLink size={14} aria-hidden="true" />发布页</button>}
              <div className="update-modal-actions-main">
                <button type="button" className="update-modal-button" disabled={downloading} onClick={onClose}>{showDetail ? '稍后' : '关闭'}</button>
                {!checking && checkError && onRecheck && <button type="button" className="update-modal-button update-modal-primary" onClick={onRecheck}><RefreshCw size={14} aria-hidden="true" />重试</button>}
                {showDetail && <button type="button" className="update-modal-button update-modal-primary" disabled={downloading || !canInstall} onClick={handleDownloadAndInstall}><Download size={14} aria-hidden="true" />{downloading ? '正在下载' : '下载并安装'}</button>}
              </div>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Portal>
  </Dialog.Root>;
}
