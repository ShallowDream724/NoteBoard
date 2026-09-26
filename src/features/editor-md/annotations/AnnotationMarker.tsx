import type { Decoration } from '@tiptap/pm/view';
import { annotationIndicatorAttributes, annotationMarkerClass, annotationMarkerId, type AnnotationMarkerPlacement } from './marker';

export function AnnotationMarker({ decorations, placement = 'toolbar' }: {
  decorations: readonly Decoration[]; placement?: AnnotationMarkerPlacement;
}) {
  const id = annotationMarkerId(decorations);
  return id ? <span className={annotationMarkerClass(placement)} contentEditable={false}>
    <button type="button" {...annotationIndicatorAttributes(id)} contentEditable={false}>?</button>
  </span> : null;
}
