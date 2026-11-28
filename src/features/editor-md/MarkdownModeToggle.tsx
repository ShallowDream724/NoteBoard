import { DocumentModeToggle } from '../../components/DocumentModeToggle';

interface MarkdownModeToggleProps {
  viewMode: 'visual' | 'source';
  onToggle: (mode?: 'visual' | 'source') => void;
  nativeDocument?: boolean;
}

export function MarkdownModeToggle({ viewMode, onToggle, nativeDocument = false }: MarkdownModeToggleProps) {
  return <DocumentModeToggle viewMode={viewMode} onToggle={onToggle} label="文档视图" options={{
    visual: { label: '可视化', accessibleName: '切换至可视化模式', tooltip: '可视化模式 (所见即所得)' },
    source: { label: '源码', accessibleName: '切换至源码模式', shortcut: 'Ctrl+/',
      tooltip: nativeDocument ? '源码模式 (声明式文档)' : '源码模式 (Markdown 原文)' },
  }} />;
}
