import { Code, Eye } from 'lucide-react';
import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useSaveActivityStore } from '../../stores/saveActivityStore';
import { emit } from '../../core/emitter';
import { fileExtension, getFileFormat, isCodeSourceFile } from '../../core/fileFormats';
import { getCodeLanguage } from '../../core/codeLanguages';
import { resolveEditorKind } from '../../features/editor-host/editorLoaders';
import { PdfStatusSlot } from '../../features/pdf-viewer/PdfStatusSlot';
import { ImageStatusSlot } from '../../features/image-viewer/ImageStatusSlot';
import { SourceReadingStatus } from '../../features/editor-code/SourceReadingStatus';
import { useDocumentStatistics } from '../../features/document-statistics/useDocumentStatistics';
import { DOCUMENT_STATISTICS_DESCRIPTION } from '../../features/document-statistics/documentStatistics';
import { Tooltip } from '../Tooltip';
import { documentSaveStatus } from '../documentSaveStatus';
import { CodeStatusSettings } from './CodeStatusSettings';
import { TextFormatStatus } from './TextFormatStatus';
import { StatusPathBreadcrumbs } from './StatusPathBreadcrumbs';
import './statusbar.css';

export function StatusBar({ referencePdfKey }: { referencePdfKey?: string }) {
  const tab = useWindowStore(state => state.activeTab());
  const doc = useDocumentStore(state => tab && state.getDocument(tab.key));
  const activity = useSaveActivityStore(state => tab ? state.activities.get(tab.key) : undefined);
  const source = tab?.viewMode === 'source';
  const codeFile = !!tab && doc?.kind === 'code' && isCodeSourceFile(tab.key, doc.language);
  const stats = useDocumentStatistics(codeFile ? null : tab?.key ?? null, doc?.kind, codeFile ? null : doc?.content, !source);
  const reference = referencePdfKey && <PdfStatusSlot pane="reference" documentKey={referencePdfKey} />;
  if (!doc || !tab) return <footer className="nb-statusbar"><span className="nb-status-metadata nb-status-field">NoteBoard</span>{reference}</footer>;

  const preview = doc.kind === 'code' ? getFileFormat(tab.key).preview : undefined;
  const html = preview === 'html';
  const modeSwitch = doc.kind === 'markdown' || doc.kind === 'noteboard';
  const codeSettings = resolveEditorKind(tab) === 'code';
  const format = html ? 'HTML' : doc.kind === 'noteboard' ? 'NoteBoard 文档' : doc.kind === 'markdown' ? 'Markdown'
    : doc.kind === 'pdf' ? 'PDF' : doc.kind === 'board' ? '画板' : doc.kind === 'bitable' ? '多维表格'
    : doc.kind === 'mindmap' ? '思维导图' : doc.kind === 'drawio' ? 'draw.io'
    : doc.kind === 'image' || doc.kind === 'unsupported' ? fileExtension(tab.key).toUpperCase() || (doc.kind === 'image' ? '图片' : '文件')
    : getCodeLanguage(doc.language)?.label ?? (doc.language === 'plaintext' ? '纯文本' : doc.language.toUpperCase());
  const mode = source ? '源码' : '可视化';
  const action = `切换为${source ? '可视化' : '源码'}模式`;
  const save = documentSaveStatus(doc, tab.isDetached, activity);
  return <footer className="nb-statusbar" aria-label="文档状态">
    <div className="nb-status-metadata">
      <StatusPathBreadcrumbs path={tab.isDetached ? null : tab.path} displayName={tab.displayName} />
    </div>
    <div className="nb-status-details">
      {reference}
      {doc.kind === 'image' && <ImageStatusSlot documentKey={tab.key}/>}
      {doc.kind === 'pdf' && <PdfStatusSlot pane="primary" documentKey={tab.key}/>}
      {modeSwitch ? <Tooltip content={action} shortcut="Ctrl+/" side="top">
        <button type="button" className="nb-status-mode nb-status-field" aria-label={action}
          onClick={() => emit('toggle-md-view-mode', { key: tab.key })}>
          {source ? <Code size={13}/> : <Eye size={13}/>}<span>{format} ({mode})</span>
        </button>
      </Tooltip> : !codeSettings && doc.kind !== 'image' && <span className="nb-status-field">{format}</span>}
      {stats && <Tooltip content={DOCUMENT_STATISTICS_DESCRIPTION} side="top">
        <span className="nb-status-field nb-status-count" aria-label="正文统计">
          {stats.characters.toLocaleString()} 字符 · {stats.words.toLocaleString()} 字词
        </span>
      </Tooltip>}
      <TextFormatStatus doc={doc} detached={!!tab.isDetached} />
      {codeSettings && codeFile && (!preview || source) && <SourceReadingStatus docKey={tab.key}/>}
      {codeSettings && <CodeStatusSettings key={tab.key} docKey={tab.key} language={doc.language} preview={!!preview && !source}/>}
      {save.visible && doc.readonly && <span className="nb-status-field nb-status-readonly">只读</span>}
      {save.visible && (save.state !== 'saved' || !doc.readonly && !codeFile) && <Tooltip content={save.description} side="top">
        <span className="nb-status-field" role="status" style={{ color: save.color }}>{save.label}</span>
      </Tooltip>}
    </div>
  </footer>;
}
