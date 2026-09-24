import { useEffect, useSyncExternalStore } from 'react';
import * as ipc from '../../core/ipc/commands';
import type { FontFamily } from '../../core/ipc/types';
import { getApplicationFontFamilies, PACKAGED_FONT_FAMILIES, subscribeApplicationFontFamilies } from '../../app/fontPack';

export type FontFilterCategory = 'all' | 'zh' | 'en' | 'mono';
interface Catalog { fonts: FontFamily[]; applicationFonts: ReadonlySet<string>; loading: boolean; error: string }
let systemFonts: FontFamily[] | null = null;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function mergeFonts(): FontFamily[] {
  const registered = new Set(getApplicationFontFamilies().map(name => name.toLowerCase()));
  const map = new Map<string, FontFamily>();
  PACKAGED_FONT_FAMILIES.forEach((family, index) => {
    if (registered.has(family.toLowerCase())) map.set(family.toLowerCase(), { family, isMonospace: true, hasCjk: index === 1 });
  });
  for (const font of systemFonts ?? []) if (!map.has(font.family.toLowerCase())) map.set(font.family.toLowerCase(), font);
  return [...map.values()];
}
const applicationFonts = () => new Set(getApplicationFontFamilies().map(name => name.toLowerCase()));
let snapshot: Catalog = { fonts: mergeFonts(), applicationFonts: applicationFonts(), loading: false, error: '' };
const getSnapshot = () => snapshot;
function publish(patch: Partial<Catalog>) { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const dormant = () => () => {};
subscribeApplicationFontFamilies(() => publish({ fonts: mergeFonts(), applicationFonts: applicationFonts() }));

export function loadFontCatalog(): Promise<void> {
  if (systemFonts) return Promise.resolve();
  if (request) return request;
  publish({ loading: true, error: '' });
  request = ipc.listSystemFonts().then(fonts => {
    systemFonts = fonts; publish({ fonts: mergeFonts(), loading: false });
  }).catch(() => publish({ loading: false, error: '无法读取系统字体，请重试。' })).finally(() => { request = null; });
  return request;
}

/** Only an open picker subscribes or requests the shared catalog. */
export function useFontCatalog(open: boolean): Catalog {
  const catalog = useSyncExternalStore(open ? subscribe : dormant, getSnapshot, getSnapshot);
  useEffect(() => { if (open) void loadFontCatalog(); }, [open]);
  return catalog;
}

function isCjk(font: FontFamily): boolean {
  return font.hasCjk || /[\u4e00-\u9fff]/.test(font.family) || /yahei|simsun|simhei|kaiti|fangsong|dengxian|pingfang|noto sans sc|noto serif sc|source han|songti|heiti|lxgw|xiawu|sarasa|maple|wenquanyi|jhenghei|mingliu/i.test(font.family);
}
function isMono(font: FontFamily): boolean {
  return font.isMonospace || /mono|code|consolas|courier|typewriter|terminal|fixed|fira|jetbrains|maple|cascadia/i.test(font.family);
}
export function filterFonts(fonts: FontFamily[], category: FontFilterCategory, query: string): FontFamily[] {
  const classified = fonts.filter(font => category === 'all' || (category === 'mono' ? isMono(font) : category === 'zh' ? isCjk(font) : !isCjk(font)));
  const term = query.trim().toLowerCase();
  if (!term) return classified;
  const matches = classified.filter(font => font.family.toLowerCase().includes(term));
  return matches.length || category === 'all' ? matches : fonts.filter(font => font.family.toLowerCase().includes(term));
}
