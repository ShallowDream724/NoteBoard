import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Only the label adapts; file actions keep their order and hit targets. */
export function ExplorerHeader({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLSpanElement>(null);
  const short = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState('资源管理器');
  useLayoutEffect(() => {
    const measure = () => {
      const available = root.current!.clientWidth - 16 - actions.current!.offsetWidth - 8;
      setLabel(available >= full.current!.offsetWidth ? '资源管理器' : available >= short.current!.offsetWidth ? '文件' : '');
    };
    const observer = new ResizeObserver(measure);
    [root.current!, actions.current!, full.current!, short.current!].forEach(node => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, []);
  return <div ref={root} style={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 8px', borderBottom: '1px solid var(--explorer-border)', flexShrink: 0,
    fontSize: 'calc(var(--explorer-font-size, 13px) - 1px)', fontWeight: 600, color: 'var(--explorer-text)' }}>
    <span aria-hidden style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}><span ref={full}>资源管理器</span><span ref={short}>文件</span></span>
    {label && <span style={{ whiteSpace: 'nowrap', flex: 1 }}>{label}</span>}
    <div ref={actions} style={{ display: 'flex', flexShrink: 0 }}>{children}</div>
  </div>;
}
