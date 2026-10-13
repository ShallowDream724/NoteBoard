import { contrastRatio, parseColor } from '../../core/theme/contrast';

// The raised/code surface is the lighter of the two dark reading backgrounds;
// a color readable here also clears the document's #0f172a canvas.
const DARK_SURFACE = '#1e293b';
const DEFAULT_INK = '#18202b';
const cache = new Map<string, string>();
const backgrounds = new Map<string, string>();
const hex = (channels: number[]) => `#${channels.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/** Rendering only. Preserve a readable authored color, otherwise make the
 * smallest sRGB mix toward dark/light that clears ordinary text contrast. */
export function readableInk(color: string, background: string): string {
  const key = `${color}:${background}`, found = cache.get(key);
  if (found) return found;
  let result = color;
  try {
    if (contrastRatio(color, background) < 4.5) {
      const channels = parseColor(color);
      const candidates = [0, 255].map(endpoint => {
        const target = hex([endpoint, endpoint, endpoint]);
        if (contrastRatio(target, background) < 4.5) return { amount: Infinity, color: target };
        let low = 0, high = 1;
        for (let i = 0; i < 12; i++) {
          const amount = (low + high) / 2;
          const mixed = hex(channels.map(value => value + (endpoint - value) * amount));
          if (contrastRatio(mixed, background) >= 4.5) high = amount; else low = amount;
        }
        return { amount: high, color: hex(channels.map(value => value + (endpoint - value) * high)) };
      });
      result = candidates[0].amount <= candidates[1].amount ? candidates[0].color : candidates[1].color;
    }
  } catch { /* Unknown legacy CSS colors keep their authored rendering. */ }
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/** CSS chooses the theme without a document scan or style/selection transaction.
 * Original mark attributes remain the source for clipboard, export and storage. */
export function readableInkVariables(color: string | null | undefined, background?: string | null): Record<string, string> {
  if (!color && !background) return {};
  const light = background ? readableInk(color || DEFAULT_INK, background) : color!;
  return { '--nb-ink-light': light, '--nb-ink-dark': background ? readableInk(color || '#c6cfdd', darkBackground(background)) : readableInk(color!, DARK_SURFACE) };
}
export function readableInkStyle(color: string | null | undefined, background?: string | null): string {
  return Object.entries(readableInkVariables(color, background)).map(([name, value]) => `${name}:${value}`).join(';');
}

/** Keep the authored hue, but give pale paper fills a quiet dark counterpart.
 * Already dark fills stay intact. This is a screen token, never document data. */
export function darkBackground(color: string): string {
  const found = backgrounds.get(color); if (found) return found;
  let result = color;
  try {
    const [r, g, b] = parseColor(color).map(channel => channel / 255), max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lightness = (max + min) / 2, delta = max - min;
    if (Number.isFinite(lightness) && lightness > .23) {
      const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
      const hue = !delta ? 0 : (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
      const chroma = .4 * Math.min(.52, saturation * .75), x = chroma * (1 - Math.abs(hue % 2 - 1)), m = .2 - chroma / 2;
      const channels = hue < 1 ? [chroma,x,0] : hue < 2 ? [x,chroma,0] : hue < 3 ? [0,chroma,x] : hue < 4 ? [0,x,chroma] : hue < 5 ? [x,0,chroma] : [chroma,0,x];
      result = hex(channels.map(channel => (channel + m) * 255));
    }
  } catch { /* Keep unknown legacy CSS colors unchanged. */ }
  if (backgrounds.size >= 256) backgrounds.delete(backgrounds.keys().next().value!);
  backgrounds.set(color, result); return result;
}
export function screenFillVariables(background?: string | null): Record<string, string> {
  return background ? { '--nb-fill-dark': darkBackground(background) } : {};
}
