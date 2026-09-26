import type { Decoration } from '@tiptap/pm/view';

export type AnnotationMarkerPlacement = 'inline' | 'block' | 'toolbar' | 'edge';

export function annotationMarkerId(decorations: readonly Decoration[]): string | null {
  return decorations.find(decoration => typeof decoration.spec.annotationId === 'string')?.spec.annotationId ?? null;
}

export const annotationMarkerClass = (placement: AnnotationMarkerPlacement) => `nb-annotation-${placement}-marker`;
export const annotationIndicatorAttributes = (id: string) => ({
  className: 'nb-annotation-indicator', 'aria-label': '打开补充说明', 'data-annotation-id': id,
});

/** DOM views and decoration widgets use the same marker contract as React views. */
export function createAnnotationMarker(id: string | null, placement: AnnotationMarkerPlacement): HTMLSpanElement {
  const marker = document.createElement('span');
  marker.className = annotationMarkerClass(placement); marker.contentEditable = 'false';
  const button = document.createElement('button');
  button.type = 'button'; button.contentEditable = 'false'; button.textContent = '?';
  const attributes = annotationIndicatorAttributes(id ?? '');
  button.className = attributes.className;
  button.setAttribute('aria-label', attributes['aria-label']);
  marker.append(button); updateAnnotationMarker(marker, id);
  return marker;
}

export function updateAnnotationMarker(marker: HTMLElement, id: string | null): void {
  marker.hidden = !id;
  const button = marker.firstElementChild as HTMLElement;
  if (id) button.dataset.annotationId = id;
  else delete button.dataset.annotationId;
}
