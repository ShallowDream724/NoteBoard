export interface AnnotationGeometry { x: number; y: number; width: number; height?: number }
export interface AnnotationBoundary { left: number; top: number; width: number; height: number }
export function constrainAnnotationGeometry(value: AnnotationGeometry, boundary: AnnotationBoundary): AnnotationGeometry {
  const gap = 8, width = Math.min(Math.max(220, value.width), Math.max(120, boundary.width - gap * 2));
  const height = value.height === undefined ? undefined : Math.min(Math.max(150, value.height), Math.max(80, boundary.height - gap * 2));
  return { width, ...(height !== undefined ? { height } : {}),
    x: Math.min(Math.max(boundary.left + gap, value.x), boundary.left + Math.max(gap, boundary.width - width - gap)),
    y: Math.min(Math.max(boundary.top + gap, value.y), boundary.top + Math.max(gap, boundary.height - (height ?? 180) - gap)),
  };
}
