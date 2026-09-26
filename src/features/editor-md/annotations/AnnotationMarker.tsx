import type { Decoration } from '@tiptap/pm/view';
import { annotationIndicatorAttributes, annotationMarkerClass, annotationMarkerId, type AnnotationMarkerPlacement } from './marker';

export function AnnotationMarker({ decorations, placement = 'toolbar' }: {
  decorations: readonly Decoration[]; placement?: AnnotationMarkerPlacement;
}) {
  const id = annotationMarkerId(decorations);
  const indicator = <button type="button" {...annotationIndicatorAttributes(id ?? '')} contentEditable={false}>?</button>;
  return id ? <span className={annotationMarkerClass(placement)} contentEditable={false}>
    {placement === 'inline' ? <span className="nb-annotation-inline-anchor">{indicator}</span> : indicator}
  </span> : null;
}
