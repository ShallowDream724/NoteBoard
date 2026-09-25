import { useEffect, useRef, useState } from 'react';

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, (entry: IntersectionObserverEntry) => void>();
/** One observer for all images. Hidden carousel slides do not keep decoded
 * image elements mounted. The browser still owns its normal resource cache. */
export function useImageVisibility() {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(140);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current; if (!element || typeof IntersectionObserver === 'undefined') return;
    observer ??= new IntersectionObserver(entries => { for (const entry of entries) callbacks.get(entry.target)?.(entry); }, { rootMargin: '320px' });
    callbacks.set(element, entry => { if (entry.boundingClientRect.height > 0) height.current = entry.boundingClientRect.height; setVisible(entry.isIntersecting); }); observer.observe(element);
    return () => { observer?.unobserve(element); callbacks.delete(element); if (!callbacks.size) { observer?.disconnect(); observer = null; } };
  }, []);
  return { ref, visible, placeholderHeight: height.current };
}
