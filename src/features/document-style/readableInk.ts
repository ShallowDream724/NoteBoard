import { contrastRatio, parseColor } from '../../core/theme/contrast';

// The raised/code surface is the lighter of the two dark reading backgrounds;
// a color readable here also clears the document's #0f172a canvas.
const DARK_SURFACE = '#1e293b';
const DEFAULT_INK = '#18202b';
const cache = new Map<string, string>();
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
  return { '--nb-ink-light': light, '--nb-ink-dark': background ? light : readableInk(color!, DARK_SURFACE) };
}
export function readableInkStyle(color: string | null | undefined, background?: string | null): string {
  return Object.entries(readableInkVariables(color, background)).map(([name, value]) => `${name}:${value}`).join(';');
}
