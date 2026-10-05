import { lazy, Suspense } from 'react';
import type { FileFormat } from '../../core/fileFormats';
import { HtmlPreview } from './HtmlPreview';

const DelimitedPreview = lazy(() => import('./DelimitedPreview').then(module => ({ default: module.DelimitedPreview })));

export function FileTextPreview({ format, text, title, onShowSource }: {
  format: FileFormat; text: string; title: string; onShowSource: () => void;
}) {
  if (format.preview === 'html') return <HtmlPreview html={text} title={title} />;
  return <Suspense fallback={<div role="status" style={{ padding: 24 }}>正在打开预览…</div>}>
    {format.preview === 'delimited' && <DelimitedPreview text={text} title={title} delimiter={format.delimiter ?? ','} onShowSource={onShowSource} />}
  </Suspense>;
}
