import { useEffect, useRef, useState, type RefObject } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { DialogShell } from '../../components/TransientDialog';
import { useDocumentStore } from '../../stores/documentStore';
import { nbEditorTheme } from '../editor-code/theme';
import { nbMergeDiffTheme } from '../textdiff/mergeTheme';
import { readExternalChangeComparison, type ExternalChangeComparison } from './externalChangeComparison';
import './externalChangeDiffDialog.css';

const EDITOR_TITLE = '当前编辑内容';
const DISK_TITLE = '磁盘文件';
const readOnlyExtensions = [
  EditorState.readOnly.of(true), EditorView.editable.of(false),
  lineNumbers(), nbEditorTheme, nbMergeDiffTheme,
];

function viewExtensions(label: string) {
  return [...readOnlyExtensions, EditorView.contentAttributes.of({
    'aria-label': label, 'aria-readonly': 'true', tabindex: '0',
  })];
}

function VersionDiff({ editorText, diskText }: ExternalChangeComparison) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const [chunks, setChunks] = useState(0);
  const [approximate, setApproximate] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    try {
      const view = new MergeView({
        parent: host.current,
        a: { doc: editorText, extensions: viewExtensions(EDITOR_TITLE) },
        b: { doc: diskText, extensions: viewExtensions(DISK_TITLE) },
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 8 },
        diffConfig: { scanLimit: 500, timeout: 40 },
      });
      merge.current = view;
      setChunks(view.chunks.length);
      setApproximate(view.chunks.some(chunk => !chunk.precise));
      return () => {
        merge.current = null;
        view.destroy();
      };
    } catch (error) {
      console.error('差异视图初始化失败:', error);
      setFailed(true);
    }
  }, [editorText, diskText]);

  function moveTo(index: number) {
    const view = merge.current;
    const chunk = view?.chunks[index];
    if (!view || !chunk) return;
    const anchor = Math.min(chunk.fromA, view.a.state.doc.length);
    view.a.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start' }) });
    setCurrent(index);
  }

  return failed ? <p role="alert" className="nb-external-diff-message">无法显示文件差异。请关闭后重试。</p> : (
    <div className="nb-external-diff">
      <div className="nb-external-diff-toolbar">
        <span role="status">
          {current >= 0 ? `第 ${current + 1} 处，共 ${chunks} 处差异` : `${chunks} 处差异`}
          {approximate && '（部分已合并显示）'}
        </span>
        <button type="button" className="nb-btn-secondary" disabled={current <= 0}
          onClick={() => moveTo(current - 1)}>上一处</button>
        <button type="button" className="nb-btn-secondary" disabled={current >= chunks - 1}
          onClick={() => moveTo(current + 1)}>下一处</button>
      </div>
      <div className="nb-external-diff-labels">
        <span>{EDITOR_TITLE}</span>
        <span>{DISK_TITLE}</span>
      </div>
      <div className="nb-external-diff-host" ref={host} />
    </div>
  );
}

export default function ExternalChangeDiffDialog({ docKey, onDismiss, restoreFocusTo }: {
  docKey: string;
  onDismiss: () => void;
  restoreFocusTo: RefObject<HTMLElement | null>;
}) {
  const displayName = useDocumentStore(s => s.getDocument(docKey)?.displayName);
  const [result, setResult] = useState<ExternalChangeComparison | { error: string } | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void readExternalChangeComparison(docKey, request.signal).then(
      comparison => { if (!request.signal.aborted) setResult(comparison); },
      error => {
        if (!request.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          setResult({ error: message || '无法读取文件差异，请重试。' });
        }
      },
    );
    return () => request.abort();
  }, [docKey]);

  return (
    <DialogShell title="查看文件差异" description={displayName ?? docKey} width={1100}
      onDismiss={onDismiss} restoreFocusTo={restoreFocusTo}>
      {result === null ? (
        <p role="status" className="nb-external-diff-message">正在读取文件版本…</p>
      ) : 'error' in result ? (
        <p role="alert" className="nb-external-diff-message">{result.error}</p>
      ) : result.editorText === result.diskText ? (
        <p role="status" className="nb-external-diff-message">当前编辑内容与磁盘文件的文本相同。</p>
      ) : (
        <VersionDiff {...result} />
      )}
    </DialogShell>
  );
}
