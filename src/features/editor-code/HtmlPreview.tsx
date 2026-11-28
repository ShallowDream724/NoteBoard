import { useMemo } from 'react';
import enhancementUrl from '../export/standaloneEnhancement.runtime.js?url';
import { rewriteHtmlPreviewAssets } from './htmlPreviewAssets';

/** Export controls run in an opaque origin; authored scripts are blocked by CSP. */
export function HtmlPreview({ html, title, directory }: { html: string; title: string; directory: string }) {
  const { source, interactive } = useMemo(() => {
    const generatedHead = /^<!doctype html>\s*<html lang="zh-CN" data-noteboard-export><head>/i;
    const generated = generatedHead.test(html);
    const resolved = rewriteHtmlPreviewAssets(html, directory, title, generated);
    if (!generated) return { source: resolved, interactive: false };
    // Only the known generated prefix can enable scripts. Put the policy at the
    // start of its head, before any authored content, while preserving standards mode.
    // The app's inherited CSP allows only same-origin scripts, so this reviewed
    // runtime is loaded as one exact static asset instead of an inline nonce.
    const runtime = new URL(enhancementUrl, document.baseURI);
    const policy = `<meta http-equiv="Content-Security-Policy" content="script-src ${runtime.origin}${runtime.pathname}">`;
    const controlled = resolved.replace(generatedHead, head => head + policy)
      .replace('</head>', '<style>.export-page-actions{display:none!important}</style></head>')
      .replace('</body>', `<script src="${runtime.href}"></script></body>`);
    return { source: controlled, interactive: true };
  }, [html, directory, title]);
  return <iframe title={`${title} HTML 预览`} sandbox={interactive ? 'allow-scripts' : ''} referrerPolicy="no-referrer"
    srcDoc={source} style={{ width: '100%', flex: 1, minHeight: 0, border: 0, background: '#fff' }} />;
}
