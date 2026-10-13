// Read the shipped stylesheet: a duplicated palette can pass contrast checks
// while the actual UI has already changed.
import stylesheet from '../../src/styles/globals.css?raw';
import { THEME_IDS } from '@/core/theme/tokens';
import type { ThemeId } from '@/core/ipc/types';

export const THEME_TOKENS = Object.fromEntries(THEME_IDS.map(theme => {
  const tokens: Record<string, string> = {};
  for (const block of stylesheet.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    if (!block[1].includes(`:root[data-theme="${theme}"]`)) continue;
    for (const declaration of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[declaration[1]] = declaration[2].trim();
    }
  }
  return [theme, tokens];
})) as Record<ThemeId, Record<string, string>>;
