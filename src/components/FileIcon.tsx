import { memo, type CSSProperties, type ReactNode } from 'react';
import { resolveFileIcon } from '../core/fileIconCatalog';
import pierreSprite from '../assets/file-icons.svg?url';
import nativeSprite from '../assets/noteboard-file-icons.svg?url';
import './FileIcon.css';

export interface FileIconOptions {
  size?: number;
  isDir?: boolean;
  isOpen?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One SVG resource is shared across rows. No effects, subscriptions,
 * per-file imports or path caches; CSS handles theme changes without rerenders. */
export const FileIcon = memo(function FileIcon({ fileName, size = 14, isDir = false,
  isOpen = false, className = '', style }: FileIconOptions & { fileName: string }) {
  const icon = resolveFileIcon(fileName, isDir, isOpen);
  const classes = `nb-file-type-icon nb-file-tone-${icon.tone}${icon.secondaryTone ? ` nb-file-secondary-${icon.secondaryTone}` : ''} ${className}`.trim();
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
    className={classes} style={style} aria-hidden="true" focusable="false"
    data-file-icon={icon.symbol}>
    <use href={`${icon.native ? nativeSprite : pierreSprite}#${icon.symbol}`} />
  </svg>;
});

export function getFileIcon(fileNameOrPath: string, options: FileIconOptions = {}): ReactNode {
  return <FileIcon fileName={fileNameOrPath} {...options} />;
}

/** Fixed-format actions share the resulting file's resolver and glyph.
 * Create these components once at module scope, not during a render. */
export function createFileTypeIcon(fileName: string) {
  return memo(function FileTypeIcon({ size, className, style }: FileIconOptions & { color?: string; fill?: string }) {
    return <FileIcon fileName={fileName} size={size} className={className} style={style} />;
  });
}

export const NoteBoardFileIcon = createFileTypeIcon('document.nb');
