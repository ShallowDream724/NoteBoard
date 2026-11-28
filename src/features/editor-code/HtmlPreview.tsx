import { useEffect, useMemo, useState } from 'react';
import { openWithDefaultApp } from '../../core/ipc/commands';
import { showToast } from '../../stores/toastStore';
import enhancementUrl from '../export/standaloneEnhancement.runtime.js?url';
import { loadHtmlPreviewAssets, planHtmlPreview } from './htmlPreviewAssets';
import './HtmlPreview.css';

const generatedHead = /^<!doctype html>\s*<html lang="zh-CN" data-noteboard-export><head>/i;

/** Export controls run in an opaque origin; authored scripts are blocked by CSP. */
export function HtmlPreview({ html, title, directory, savedPath, onShowSource }: {
  html: string; title: string; directory: string; savedPath?: string; onShowSource: () => void;
}) {
  const interactive = generatedHead.test(html);
  const preview = useMemo(() => {
    try {
      return planHtmlPreview(html, directory, title, interactive);
    } catch {
      return null;
    }
  }, [html, directory, title, interactive]);
  const plan = preview?.assets;
  const [resolved, setResolved] = useState<{ plan: NonNullable<typeof plan>; source: string } | null>(null);
  useEffect(() => {
    setResolved(null);
    if (!plan) return;
    const controller = new AbortController();
    const finish = (source: string) => {
      if (!controller.signal.aborted) setResolved({ plan, source });
    };
    void loadHtmlPreviewAssets(plan, controller.signal).then(finish, () => finish(plan.source));
    return () => controller.abort();
  }, [plan]);
  const source = plan ? (resolved?.plan === plan ? resolved.source : null) : html;
  const srcDoc = useMemo(() => {
    if (source === null || !interactive) return source;
    // Only the known generated prefix can enable scripts. Put the policy at the
    // start of its head, before any authored content, while preserving standards mode.
    // The app's inherited CSP allows only same-origin scripts, so this reviewed
    // runtime is loaded as one exact static asset instead of an inline nonce.
    const runtime = new URL(enhancementUrl, document.baseURI);
    const policy = `<meta http-equiv="Content-Security-Policy" content="script-src ${runtime.origin}${runtime.pathname}">`;
    return source.replace(generatedHead, head => head + policy)
      .replace('</head>', '<style>.export-page-actions{display:none!important}</style></head>')
      .replace('</body>', `<script src="${runtime.href}"></script></body>`);
  }, [source, interactive]);
  if (!preview) return <PreviewMessage message="无法准备 HTML 预览。" error savedPath={savedPath} onShowSource={onShowSource} />;
  const message = preview.hasCanvas
    ? '应用内预览不会运行此页面的 JavaScript，画布内容可能为空。'
    : '应用内预览不会运行此页面的 JavaScript，脚本生成的内容和交互可能不可用。';
  return <>
    {preview.hasScripts && <PreviewMessage message={message} savedPath={savedPath} onShowSource={onShowSource} />}
    {srcDoc === null ? <div role="status" style={{ padding: 24 }}>正在打开预览…</div> :
      <iframe title={`${title} HTML 预览`} sandbox={interactive ? 'allow-scripts' : ''} referrerPolicy="no-referrer"
        srcDoc={srcDoc} style={{ width: '100%', flex: 1, minHeight: 0, border: 0, background: '#fff' }} />}
  </>;
}

function PreviewMessage({ message, error, savedPath, onShowSource }: {
  message: string; error?: boolean; savedPath?: string; onShowSource: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const openSaved = async () => {
    if (!savedPath || opening) return;
    setOpening(true);
    try {
      await openWithDefaultApp(savedPath);
    } catch (error) {
      showToast(`打开 HTML 失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setOpening(false);
    }
  };
  return <div className="nb-html-preview-message">
    <p role={error ? 'alert' : 'status'}>{message}</p>
    {savedPath
      ? <button type="button" disabled={opening} title="用系统默认应用打开已保存的 HTML" onClick={openSaved}>在浏览器中打开</button>
      : <button type="button" onClick={onShowSource}>查看源码</button>}
  </div>;
}
