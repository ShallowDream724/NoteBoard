import { useEffect, useMemo, useState } from 'react';
import enhancementUrl from '../export/standaloneEnhancement.runtime.js?url';
import { loadHtmlPreviewAssets, planHtmlPreviewAssets } from './htmlPreviewAssets';

const generatedHead = /^<!doctype html>\s*<html lang="zh-CN" data-noteboard-export><head>/i;

/** Export controls run in an opaque origin; authored scripts are blocked by CSP. */
export function HtmlPreview({ html, title, directory }: { html: string; title: string; directory: string }) {
  const interactive = generatedHead.test(html);
  const plan = useMemo(() => planHtmlPreviewAssets(html, directory, title, interactive), [html, directory, title, interactive]);
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
  if (srcDoc === null) return <div role="status" style={{ padding: 24 }}>正在打开预览…</div>;
  return <iframe title={`${title} HTML 预览`} sandbox={interactive ? 'allow-scripts' : ''} referrerPolicy="no-referrer"
    srcDoc={srcDoc} style={{ width: '100%', flex: 1, minHeight: 0, border: 0, background: '#fff' }} />;
}
