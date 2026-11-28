import { lazy, Suspense } from 'react';
import type { FileFormat } from '../../core/fileFormats';

const HtmlPreview = lazy(() => import('./HtmlPreview').then(module => ({ default: module.HtmlPreview })));
const DelimitedPreview = lazy(() => import('./DelimitedPreview').then(module => ({ default: module.DelimitedPreview })));

export function FileTextPreview({ format, text, title, directory, savedPath, onShowSource }: {
  format: FileFormat; text: string; title: string; directory: string; savedPath?: string; onShowSource: () => void;
}) {
  return <Suspense fallback={<div role="status" style={{ padding: 24 }}>正在打开预览…</div>}>
    {format.preview === 'html' && <HtmlPreview html={text} title={title} directory={directory} savedPath={savedPath} onShowSource={onShowSource} />}
    {format.preview === 'delimited' && <DelimitedPreview text={text} title={title} delimiter={format.delimiter ?? ','} onShowSource={onShowSource} />}
  </Suspense>;
}
