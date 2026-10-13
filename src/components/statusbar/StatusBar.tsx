// NoteBoard StatusBar
// 底部状态栏：文本统计、编码、行尾符、类型/模式、保存状态
// 详见 docs/07-UI布局与交互规范.md §8

import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useMemo } from 'react';
import { saveDocument } from '../../features/editor-code/orchestration/saveDocument';
import { emit } from '../../core/emitter';
import { Eye, Code, Save, LoaderCircle } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { getCodeLanguage } from '../../core/codeLanguages';
import { isEditable } from '../../core/docKind';
import { useSaveActivityStore } from '../../stores/saveActivityStore';
import './statusbar.css';

export function StatusBar() {
  const activeKey = useWindowStore((s) => s.activeKey);
  const activeTab = useWindowStore((s) => (activeKey ? s.getTab(activeKey) : undefined));
  const doc = useDocumentStore((s) => (activeKey ? s.documents.get(activeKey) : undefined));
  const activity = useSaveActivityStore(s => activeKey ? s.activities.get(activeKey) : undefined);
  const textStatistics = useMemo(() => {
    const content = doc?.content;
    if (content == null || (doc?.kind === 'noteboard' && activeTab?.viewMode !== 'source')) return null;
    let lines = 1;
    for (let index = 0; index < content.length; index += 1) {
      if (content.charCodeAt(index) === 10) lines += 1;
    }
    return { characters: content.length, lines };
  }, [doc?.content, doc?.kind, activeTab?.viewMode]);

  if (!doc) {
    return (
      <div
        style={{
          height: 'max(24px, calc(var(--ui-font-size, 13px) + 10px))',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          background: 'var(--statusbar-bg)',
          borderTop: '1px solid var(--editor-border)',
          color: 'var(--statusbar-text)',
          fontFamily: 'var(--ui-font-family, inherit)',
          fontSize: 'calc(var(--ui-font-size, 13px) - 1px)',
          lineHeight: 1.25,
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--statusbar-text)' }}>NoteBoard</span>
      </div>
    );
  }

  const sectionStyle: React.CSSProperties = {
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: '100%',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const dividerStyle: React.CSSProperties = {
    width: 1,
    height: 14,
    background: 'var(--editor-border)',
  };

  // 保存状态判定
  let saveStatus = '已保存';
  let saveStatusColor = 'var(--statusbar-text)';
  let saveStatusTitle = doc.savePolicy === 'auto' ? '自动保存已启用 · 文件已保存' : '文件已保存';

  const saving = Boolean(activity?.pending);
  const needsPath = doc.key.startsWith('untitled:') || activeTab?.isDetached || doc.externalStatus === 'deleted';
  const canSave = isEditable(doc.kind) && !doc.readonly;
  if (saving) {
    saveStatus = '正在保存';
    saveStatusColor = 'var(--accent-strong)';
    saveStatusTitle = '正在写入文件';
  } else if (activity?.error) {
    saveStatus = '保存失败';
    saveStatusColor = 'var(--error-500)';
    saveStatusTitle = activity.error;
  } else if (doc.isDirty || needsPath) {
    saveStatus = '未保存';
    saveStatusColor = 'var(--warning-600)';
    saveStatusTitle = needsPath ? '选择文件位置以保存文档' : doc.savePolicy === 'auto' ? '修改尚未写入，自动保存已启用' : '有未保存的修改，按 Ctrl+S 保存';
  }

  // 类型显示
  const typeLabel =
    doc.kind === 'noteboard' ? 'NoteBoard 文档' : doc.kind === 'markdown'
      ? 'Markdown'
      : doc.kind === 'board'
        ? '画板'
        : doc.language === 'sql'
          ? 'SQL'
          : doc.language === 'json'
            ? 'JSON'
            : doc.language === 'yaml'
              ? 'YAML'
              : doc.language === 'xml'
                ? 'XML'
                : doc.language === 'html' ? 'HTML'
                : doc.language === 'markdown'
                  ? 'Markdown'
                  : getCodeLanguage(doc.language)?.label ?? '纯文本';

  return (
    <div
      style={{
        height: 'max(24px, calc(var(--ui-font-size, 13px) + 10px))',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--statusbar-bg)',
        borderTop: '1px solid var(--editor-border)',
        color: 'var(--statusbar-text)',
        fontFamily: 'var(--ui-font-family, inherit)',
        fontSize: 'calc(var(--ui-font-size, 13px) - 1px)',
        lineHeight: 1.25,
        flexShrink: 0,
        overflow: 'hidden',
      }}
      role="status"
    >
      <div className="nb-status-metadata">
      {/* Native visual documents do not count their serialized frames as prose. */}
      {textStatistics && <>
        <div style={sectionStyle}>
          <span>
            {doc.kind === 'noteboard' ? '原始记录 ' : ''}{textStatistics.characters.toLocaleString()} {doc.kind === 'noteboard' ? '字符' : '字'} · {textStatistics.lines.toLocaleString()} 行
          </span>
        </div>
        <div style={dividerStyle} />
      </>}

      {doc.content !== null && <>
      {/* 编码 */}
      <div style={sectionStyle}>
        <span>{doc.encoding === 'utf8' ? 'UTF-8' : doc.encoding === 'utf8-bom' ? 'UTF-8 BOM' : 'GBK'}</span>
      </div>
      <div style={dividerStyle} />

      {/* 行尾符 */}
      <div style={sectionStyle}>
        <span>{doc.eol === 'crlf' ? 'CRLF' : 'LF'}</span>
      </div>
      <div style={dividerStyle} />

      </>}
      {/* 类型 / 富文档模式切换 */}
      {doc.kind === 'markdown' ? (
        <Tooltip
          content={`当前：${typeLabel} (${activeTab?.viewMode === 'source' ? '源码模式' : '可视化模式'}) · 点击切换`}
          shortcut="Ctrl+/"
          side="top"
          sideOffset={6}
        >
          <button
            type="button"
            aria-label={`切换为${activeTab?.viewMode === 'source' ? '可视化' : '源码'}模式`}
            style={{
              ...sectionStyle,
              border: 0,
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              borderRadius: 3,
              transition: 'all var(--transition-fast)',
            }}
            onClick={() => {
              if (activeKey) {
                emit('toggle-md-view-mode', { key: activeKey });
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--toolbar-hover)';
              e.currentTarget.style.color = 'var(--editor-text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--statusbar-text)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = 'var(--toolbar-active)';
              e.currentTarget.style.transform = 'scale(0.96)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = 'var(--toolbar-hover)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {activeTab?.viewMode === 'source' ? (
              <>
                <Code size={13} style={{ flexShrink: 0 }} />
                <span>{typeLabel} (源码)</span>
              </>
            ) : (
              <>
                <Eye size={13} style={{ flexShrink: 0 }} />
                <span>{typeLabel} (可视化)</span>
              </>
            )}
          </button>
        </Tooltip>
      ) : (
        <div style={sectionStyle}>
          <span>{typeLabel}</span>
        </div>
      )}
      <div style={dividerStyle} />

      </div>
      {/* 保存状态 */}
      <Tooltip content={saveStatusTitle} side="top" sideOffset={6}>
        <div style={{ ...sectionStyle, flexShrink: 0, cursor: 'default', color: saveStatusColor }}>
          <span>{saveStatus}</span>
        </div>
      </Tooltip>
      {isEditable(doc.kind) && <Tooltip content={doc.readonly ? '只读文件，请使用另存为保存副本' : '保存当前文档'} shortcut="Ctrl+S" side="top" sideOffset={6}>
        <button type="button" className="nb-status-save" aria-label="保存当前文档" disabled={!canSave || saving}
          onClick={() => { if (activeKey) void saveDocument(activeKey); }}>
          {saving ? <LoaderCircle size={13} className="nb-status-save-spinner" /> : <Save size={13} />}
          <span>保存</span>
        </button>
      </Tooltip>}

      {/* 只读标记 */}
      {doc.readonly && (
        <>
          <div style={dividerStyle} />
          <div style={sectionStyle}>
            <span style={{ color: 'var(--warning-600)' }}>只读</span>
          </div>
        </>
      )}
    </div>
  );
}
