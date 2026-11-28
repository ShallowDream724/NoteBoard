import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { getFileIcon } from '../../components/FileIcon';
import { Tooltip } from '../../components/Tooltip';
import { isRichDocument } from '../../core/docKind';
import { useDocumentStore } from '../../stores/documentStore';
import type { Tab } from '../../stores/windowStore';
import { loadRestoredTab } from '../session/closedWindowSession';
import './referencePane.css';

const PdfViewer = lazy(() => import('../pdf-viewer/PdfViewer').then(({ PdfViewer }) => ({ default: PdfViewer })));
const RichReference = lazy(() => import('./RichReference').then(({ RichReference }) => ({ default: RichReference })));
const ImageReference = lazy(() => import('./ImageReference').then(({ ImageReference }) => ({ default: ImageReference })));

function LoadingReference() {
  return <p className="nb-reference-message" role="status">正在加载预览…</p>;
}

class ReferenceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p className="nb-reference-message" role="alert">无法显示右侧预览</p>;
    return this.props.children;
  }
}

function RestoredReference({ docKey }: { docKey: string }) {
  const [attempt, retry] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadRestoredTab(docKey).then(result => {
      if (!cancelled && result !== 'loaded' && result !== 'no-lazy') setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [docKey, attempt]);

  if (!failed) return <LoadingReference />;
  return (
    <div className="nb-reference-message">
      <p role="alert">无法读取文件</p>
      <button type="button" onClick={() => {
        setFailed(false);
        retry(value => value + 1);
      }}>重试</button>
    </div>
  );
}

function TextReference({ tab }: { tab: Tab }) {
  const document = useDocumentStore(state => state.documents.get(tab.key));
  if (document?.content == null) return <p className="nb-reference-message" role="alert">无法读取文档内容</p>;
  if (isRichDocument(tab.kind)) {
    return <RichReference docKey={tab.key} content={document.content} directory={document.dirPath} format={tab.kind} />;
  }
  return <div className="nb-reference-scroll" tabIndex={0} aria-label="文档正文">
    <pre className="nb-reference-source">{document.content}</pre>
  </div>;
}

function ReferenceContent({ tab }: { tab: Tab }) {
  if (tab.lazySource) return <RestoredReference docKey={tab.key} />;
  if (tab.path && tab.kind === 'pdf') return <PdfViewer filePath={tab.path} fileName={tab.displayName} />;
  if (tab.path && tab.kind === 'image') return <ImageReference filePath={tab.path} fileName={tab.displayName} />;
  return <TextReference tab={tab} />;
}

export function ReferencePane({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  return (
    <aside className="nb-reference-pane" aria-label={`右侧预览：${tab.displayName}`}>
      <div className="nb-reference-header">
        {getFileIcon(tab.path ?? tab.displayName, { size: 15 })}
        <span className="nb-reference-title" title={tab.path ?? tab.displayName}>{tab.displayName}</span>
        <span className="nb-reference-label">只读</span>
        <Tooltip content="关闭右侧预览" side="bottom">
          <button type="button" className="nb-reference-close" aria-label="关闭右侧预览" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <div className="nb-reference-content">
        <ReferenceErrorBoundary key={tab.key}>
          <Suspense fallback={<LoadingReference />}>
            <ReferenceContent tab={tab} />
          </Suspense>
        </ReferenceErrorBoundary>
      </div>
    </aside>
  );
}
