import { useMemo } from 'react';

/** An opaque, script-free document keeps authored HTML apart from app APIs. */
export function HtmlPreview({ html, title }: { html: string; title: string }) {
  const source = useMemo(() => html.includes('<html lang="zh-CN" data-noteboard-export')
    ? html.replace('</head>', '<style>.export-page-actions{display:none!important}</style></head>')
    : html, [html]);
  return <iframe title={`${title} HTML 预览`} sandbox="" referrerPolicy="no-referrer"
    srcDoc={source} style={{ width: '100%', flex: 1, minHeight: 0, border: 0, background: '#fff' }} />;
}
