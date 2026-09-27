/** Clockwise quarter turns, followed by reflection across the output axes. */
export interface ImageTransform {
  readonly rotation: 0 | 1 | 2 | 3;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

export type ImageTransformAction = 'rotate-cw' | 'rotate-ccw' | 'flip-horizontal' | 'flip-vertical';

export function applyImageTransform<T extends ImageTransform>(state: T, action: ImageTransformAction): T {
  switch (action) {
    case 'rotate-cw': return { ...state, rotation: ((state.rotation + 1) % 4) as ImageTransform['rotation'] };
    case 'rotate-ccw': return { ...state, rotation: ((state.rotation + 3) % 4) as ImageTransform['rotation'] };
    case 'flip-horizontal': return { ...state, flipX: !state.flipX };
    case 'flip-vertical': return { ...state, flipY: !state.flipY };
  }
}

/** CSS transforms run right to left: rotate first, then mirror along output axes. */
export function imageTransformCss(state: ImageTransform): string {
  return `scaleX(${state.flipX ? -1 : 1}) scaleY(${state.flipY ? -1 : 1}) rotate(${state.rotation * 90}deg)`;
}
