import { Fragment, Suspense, lazy, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronRight } from 'lucide-react';
import { useExplorerStore } from '../../features/explorer/explorerStore';
import { isSubPath, parentBrowsePath, sameKey } from '../../features/explorer/pathUtils';
import { normalizeFileInput } from '../../features/welcome/fileInput';
import './statusMenus.css';
import './statusPathBreadcrumbs.css';

const StatusPathDirectoryMenu = lazy(() => import('./StatusPathDirectoryMenu'));

interface PathCrumb {
  label: string;
  path: string;
  directory: string | null;
  file?: true;
}

function pathLabel(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path;
}

function breadcrumbSegments(path: string, root: string | null, displayName?: string): PathCrumb[] {
  const unknown = { label: displayName || pathLabel(path), path, directory: null, file: true as const };
  if (!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path)) return unknown.label ? [unknown] : [];

  const local = path.startsWith('/') && !path.startsWith('//') ? path : normalizeFileInput(path);
  const parent = parentBrowsePath(local);
  if (!parent) return [unknown];
  const file = { label: local, path: local, directory: parent, file: true as const };
  if (!root || !isSubPath(root, local) || sameKey(root, local)) return [file];

  const directories: PathCrumb[] = [];
  for (let directory: string | null = parent; directory; directory = parentBrowsePath(directory)) {
    const isRoot = sameKey(directory, root);
    directories.push({ label: pathLabel(isRoot ? root : directory), path: directory, directory });
    if (isRoot) return [...directories.reverse(), { ...file, label: pathLabel(local) }];
  }
  return [file];
}

const separatorWidth = 12;
type PathLayout = 'full' | 'compact' | 'file';

export function StatusPathBreadcrumbs({ path = '', displayName }: { path?: string | null; displayName?: string }) {
  const root = useExplorerStore(state => state.root);
  const revision = useExplorerStore(state => state.rootRevision);
  const strip = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => breadcrumbSegments(path ?? '', root, displayName), [path, root, displayName]);
  const [layout, setLayout] = useState<PathLayout>('full');

  useLayoutEffect(() => {
    const viewport = strip.current, natural = measure.current;
    if (!viewport || !natural) return;
    const sync = () => {
      const available = viewport.clientWidth;
      const width = natural.offsetWidth;
      const fileWidth = (natural.lastElementChild as HTMLElement | null)?.offsetWidth ?? 0;
      const extra = segments.length > 2 ? 2 * separatorWidth + 25 : separatorWidth;
      viewport.style.flexBasis = `${width + 8}px`;
      if (segments.length < 2 || !available || available >= width + 8) setLayout('full');
      else if (available < fileWidth + extra + 24) setLayout('file');
      else setLayout('compact');
    };
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(viewport);
    resize.observe(natural);
    return () => resize.disconnect();
  }, [segments]);

  if (!segments.length) return null;
  const file = segments[segments.length - 1];
  const visible = layout === 'file' ? [file]
    : layout === 'compact' && segments.length > 2 ? [segments[0], null, file] : segments;

  return <nav ref={strip} className="nb-status-breadcrumbs" aria-label="文档路径" data-compact={layout === 'compact' || undefined}>
    <div className="nb-status-breadcrumb-measure" ref={measure} aria-hidden="true">
      {segments.map((segment, index) => <Fragment key={segment.path}>
        {index > 0 && <span style={{ width: separatorWidth }} />}
        <span className="nb-status-crumb">{segment.label}</span>
      </Fragment>)}
    </div>
    {visible.map((segment, index) => <Fragment key={`${revision}:${path}:${segment?.path ?? ''}`}>
      {index > 0 && <ChevronRight className="nb-status-crumb-separator" size={separatorWidth} aria-hidden="true" />}
      {segment ? <BreadcrumbTrigger segment={segment} currentPath={file.path} explorerRoot={root ?? undefined} />
        : <span className="nb-status-crumb-ellipsis" aria-hidden="true">…</span>}
    </Fragment>)}
  </nav>;
}

function BreadcrumbTrigger({ segment, currentPath, explorerRoot }: {
  segment: PathCrumb;
  currentPath: string;
  explorerRoot?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = false) => {
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  if (!segment.directory) return <span className="nb-status-crumb" title={segment.path} aria-current="page"><bdi>{segment.label}</bdi></span>;
  const label = `${pathLabel(segment.directory)} 文件和文件夹`;

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger ref={trigger} type="button" aria-haspopup="menu" aria-current={segment.file ? 'page' : undefined}
      className="nb-status-crumb" title={segment.path} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
        }
      }}>
      <bdi>{segment.label}</bdi>
    </Popover.Trigger>
    {open && <Popover.Portal>
      <Suspense fallback={<Popover.Content role="menu" tabIndex={-1} aria-label={label} aria-busy="true"
        className="nb-status-menu nb-status-directory-menu" side="top" align="start" alignOffset={-46} sideOffset={4} collisionPadding={8}
        data-shortcuts-suspended onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { event.preventDefault(); close(true); }}
        onKeyDown={event => { if (event.key === 'Tab') close(true); }}>
        <div className="nb-status-directory-message" role="status">正在读取…</div>
      </Popover.Content>}>
        <StatusPathDirectoryMenu path={segment.directory} label={label} currentPath={currentPath} explorerRoot={explorerRoot} closeRoot={close} />
      </Suspense>
    </Popover.Portal>}
  </Popover.Root>;
}
