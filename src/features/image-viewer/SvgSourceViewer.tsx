import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { Copy, ExternalLink, Search, WrapText } from 'lucide-react';
import { openWithDefaultApp, readDocument } from '../../core/ipc/commands';
import { showToast } from '../../stores/toastStore';
import './svgSourceViewer.css';

export const SVG_SOURCE_MAX_READ_BYTES = 2 * 1024 * 1024;

export interface SvgSourceViewerHandle {
  focus(): void;
  getSelectedText(): string;
}

interface SvgSourceViewerProps {
  filePath: string;
  viewerRef?: RefObject<SvgSourceViewerHandle | null>;
}

interface SourceRuntime extends SvgSourceViewerHandle {
  view: EditorView;
  find(): void;
  setWrap(wrap: boolean): void;
}

type LoadState = 'loading' | 'ready' | 'unavailable' | 'too-large';

/** Keeps source text only in this mounted, readonly CodeMirror instance. */
export function SvgSourceViewer({ filePath, viewerRef }: SvgSourceViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SourceRuntime | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [softWrap, setSoftWrap] = useState(true);

  useEffect(() => {
    let disposed = false;
    let view: EditorView | null = null;
    let handle: SourceRuntime | null = null;
    setLoadState('loading');
    setSoftWrap(true);

    const load = async () => {
      try {
        const payload = await readDocument(filePath, SVG_SOURCE_MAX_READ_BYTES);
        if (disposed) return;
        if (payload.size > SVG_SOURCE_MAX_READ_BYTES) {
          setLoadState('too-large');
          return;
        }
        if (payload.content === null) {
          setLoadState('unavailable');
          return;
        }

        // Even CM's core is absent from the ordinary image-viewer entry.
        const [{ EditorState }, { EditorView, keymap }, search, setup, languages] = await Promise.all([
          import('@codemirror/state'),
          import('@codemirror/view'),
          import('@codemirror/search'),
          import('../editor-code/setup'),
          import('../editor-code/languages'),
        ]);
        if (disposed || !containerRef.current) return;

        view = new EditorView({
          parent: containerRef.current,
          state: EditorState.create({
            doc: payload.content,
            extensions: [
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              // Readonly facets block input/commands; this also rejects raw changes.
              EditorState.transactionFilter.of(transaction => transaction.docChanged ? [] : transaction),
              EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': 'SVG 源码', 'aria-readonly': 'true' }),
              EditorState.phrases.of({
                Find: '查找', next: '下一处', previous: '上一处', all: '全部',
                'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配', close: '关闭',
                'current match': '当前匹配', 'on line': '所在行',
              }),
              ...setup.createBaseExtensions({ softWrap: true, showLineNumbers: true }),
              keymap.of(search.searchKeymap),
            ],
          }),
        });
        const mountedView = view;
        const getSelectedText = () => mountedView.state.selection.ranges
          .filter(range => !range.empty)
          .map(range => mountedView.state.sliceDoc(range.from, range.to)).join('\n');
        handle = {
          view: mountedView,
          focus: () => mountedView.focus(),
          getSelectedText,
          find: () => { search.openSearchPanel(mountedView); },
          setWrap: wrap => mountedView.dispatch({ effects: setup.wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) }),
        };
        runtimeRef.current = handle;
        if (viewerRef) viewerRef.current = handle;
        setLoadState('ready');

        // A late grammar result must never dispatch into a destroyed view.
        void languages.loadLanguageExtension('xml').then(extension => {
          if (!disposed && runtimeRef.current === handle) {
            mountedView.dispatch({ effects: setup.languageCompartment.reconfigure(extension) });
          }
        });
      } catch (error) {
        if (!disposed) {
          setLoadState(String(error).includes('超过读取限制') ? 'too-large' : 'unavailable');
        }
      }
    };
    void load();

    return () => {
      disposed = true;
      if (viewerRef?.current === handle) viewerRef.current = null;
      if (runtimeRef.current === handle) runtimeRef.current = null;
      view?.destroy();
    };
  }, [filePath, viewerRef]);

  useEffect(() => {
    if (loadState === 'ready') runtimeRef.current?.focus();
  }, [loadState]);

  const copySource = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const selected = runtime.getSelectedText();
    try {
      await navigator.clipboard.writeText(selected || runtime.view.state.doc.toString());
      if (runtimeRef.current === runtime) showToast(selected ? '选中源码已复制' : 'SVG 源码已复制', 'success');
    } catch {
      if (runtimeRef.current === runtime) showToast('复制源码失败', 'error');
    }
  };

  return (
    <div className="svg-source-viewer">
      <div className="svg-source-toolbar">
        <span className="svg-source-title">SVG 源码</span>
        <span className="svg-source-readonly">只读</span>
        <div className="svg-source-actions">
          <button type="button" aria-label="查找源码" disabled={loadState !== 'ready'} onClick={() => runtimeRef.current?.find()}>
            <Search size={14} /><span>查找</span>
          </button>
          <button type="button" aria-label="复制源码" title="复制选区或全部源码" disabled={loadState !== 'ready'} onClick={() => void copySource()}>
            <Copy size={14} /><span>复制</span>
          </button>
          <button type="button" aria-label="自动换行" aria-pressed={softWrap} disabled={loadState !== 'ready'} onClick={() => {
            runtimeRef.current?.setWrap(!softWrap);
            setSoftWrap(!softWrap);
          }}>
            <WrapText size={14} /><span>自动换行</span>
          </button>
        </div>
      </div>
      <div ref={containerRef} className="svg-source-editor" hidden={loadState !== 'ready'} />
      {loadState === 'loading' && <div className="svg-source-message" role="status">正在读取 SVG 源码…</div>}
      {(loadState === 'unavailable' || loadState === 'too-large') && (
        <div className="svg-source-message" role="status">
          <p>{loadState === 'too-large' ? 'SVG 文件超过 2 MiB，无法在此查看源码。' : '无法读取 SVG 源码，文件可能已损坏或路径不可访问。'}</p>
          <button type="button" onClick={() => void openWithDefaultApp(filePath)}>
            <ExternalLink size={14} /><span>用系统默认程序打开</span>
          </button>
        </div>
      )}
    </div>
  );
}
