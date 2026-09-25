import { useEffect, useRef, useState } from 'react';

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, (entry: IntersectionObserverEntry) => void>();
/** Keep the active carousel page and its neighbours warm without decoding the
 * whole collection. Other images still share one viewport observer. */
export function useImageVisibility() {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(140);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current; if (!element || typeof IntersectionObserver === 'undefined') return;
    const slot = element.closest<HTMLElement>('.nb-image-slot'); let intersecting = false;
    const update = () => setVisible(intersecting || !!slot?.hasAttribute('data-carousel-nearby'));
    slot?.addEventListener('nb-carousel-proximity', update); update();
    observer ??= new IntersectionObserver(entries => { for (const entry of entries) callbacks.get(entry.target)?.(entry); }, { rootMargin: '320px' });
    callbacks.set(element, entry => { if (entry.boundingClientRect.height > 0) height.current = entry.boundingClientRect.height; intersecting = entry.isIntersecting; update(); }); observer.observe(element);
    return () => { slot?.removeEventListener('nb-carousel-proximity', update); observer?.unobserve(element); callbacks.delete(element); if (!callbacks.size) { observer?.disconnect(); observer = null; } };
  }, []);
  return { ref, visible, placeholderHeight: height.current };
}
