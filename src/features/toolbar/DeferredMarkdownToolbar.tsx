import { useEffect, useState, type ComponentProps } from 'react';
type Toolbar = typeof import('./MarkdownToolbar').MarkdownToolbar;
let ready: Toolbar | null = null;
let pending: Promise<Toolbar> | null = null;

/** Shared by file-open prefetch and every toolbar host; failed imports can retry. */
export function loadMarkdownToolbar(): Promise<Toolbar> {
  if (ready) return Promise.resolve(ready);
  return pending ??= import('./MarkdownToolbar').then(module => {
    ready = module.MarkdownToolbar;
    return ready;
  }).catch(error => { pending = null; throw error; });
}

export function DeferredMarkdownToolbar(props: ComponentProps<Toolbar>) {
  const [ToolbarComponent, setToolbar] = useState(() => ready);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void loadMarkdownToolbar().then(component => {
      if (active) setToolbar(() => component);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  if (ToolbarComponent) return <ToolbarComponent {...props}/>;
  return failed ? <button type="button" className="nb-btn-secondary" onClick={() => {
    setFailed(false); setAttempt(value => value + 1);
  }}>重新加载工具栏</button> : null;
}
