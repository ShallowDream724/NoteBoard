import { beforeEach, expect, it, vi } from 'vitest';
import type { FontPackStatus, Settings, TypographySettings } from '../../src/core/ipc/types';

const mocks = vi.hoisted(() => ({ download: vi.fn(), apply: vi.fn(), patch: vi.fn(), typography: vi.fn() }));
vi.mock('../../src/core/ipc/commands', () => ({ downloadFontPack: mocks.download, applyRecommendedFonts: mocks.apply, patchSettings: mocks.patch }));
vi.mock('../../src/app/fontPack', () => ({ activateFontPack: vi.fn(async (status: FontPackStatus) => status), ensureFaces: vi.fn(), translateFontPackError: String }));
vi.mock('../../src/core/theme/applyTheme', () => ({ applyTypography: mocks.typography, applyTheme: vi.fn(), resolveTheme: () => 'chen-guang', startSystemThemeListener: vi.fn(), stopSystemThemeListener: vi.fn() }));

const ready: FontPackStatus = { id: 'core', version: '1', state: 'ready', installedSizeBytes: 1, downloadSizeBytes: 1, downloadUrl: '', faces: [] };

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

async function setup() {
  const { useSettingsStore } = await import('../../src/stores/settingsStore');
  const { useFontPackStore } = await import('../../src/stores/fontPackStore');
  let durable: Settings = structuredClone(useSettingsStore.getState().settings);
  mocks.patch.mockImplementation(async patch => {
    durable = { ...durable, revision: durable.revision + 1, typography: { ...durable.typography, ...patch.typography } };
    return durable;
  });
  mocks.apply.mockImplementation(async (expected?: TypographySettings) => {
    const typography = { ...durable.typography };
    for (const [field, source, family] of [
      ['monoFontFamily', 'monoFontFamilySource', 'JetBrains Mono'],
      ['monoFontFamilyZh', 'monoFontFamilyZhSource', 'Maple Mono Normal NF CN'],
    ] as const) {
      const matches = expected ? typography[field] === expected[field] && typography[source] === expected[source] : typography[source] === 'automatic';
      if (matches) { typography[field] = family; typography[source] = 'automatic'; }
    }
    durable = { ...durable, revision: durable.revision + 1, typography };
    return durable;
  });
  return { settings: useSettingsStore, fonts: useFontPackStore, setDurable: (next: Settings) => { durable = next; useSettingsStore.getState()._applyRemoteUpdate(next); } };
}

it('an explicit download applies legacy selections, publishes settings, and updates rendered typography', async () => {
  const { settings, fonts, setDurable } = await setup();
  const previous = { ...settings.getState().settings, revision: 1, typography: { ...settings.getState().settings.typography, monoFontFamily: 'Consolas', monoFontFamilyZh: 'Microsoft YaHei', monoFontFamilySource: 'legacy' as const, monoFontFamilyZhSource: 'legacy' as const } };
  setDurable(previous); mocks.download.mockResolvedValue(ready);
  expect(await fonts.getState().download()).toEqual(ready);
  expect(mocks.apply).toHaveBeenCalledWith(previous.typography);
  expect(settings.getState().settings.typography).toMatchObject({ monoFontFamily: 'JetBrains Mono', monoFontFamilyZh: 'Maple Mono Normal NF CN', monoFontFamilySource: 'automatic' });
  expect(mocks.typography).toHaveBeenLastCalledWith(settings.getState().settings.typography);
});

it('a font chosen while downloading retains its explicit preference after install', async () => {
  const { settings, fonts } = await setup();
  let finish!: (value: FontPackStatus) => void;
  mocks.download.mockReturnValue(new Promise<FontPackStatus>(resolve => { finish = resolve; }));
  const installation = fonts.getState().download();
  await settings.getState().setTypography({ monoFontFamily: 'Cascadia Code' });
  finish(ready); await installation;
  expect(settings.getState().settings.typography).toMatchObject({ monoFontFamily: 'Cascadia Code', monoFontFamilySource: 'user', monoFontFamilyZh: 'Maple Mono Normal NF CN' });
  expect(mocks.patch).toHaveBeenCalledWith({ typography: { monoFontFamily: 'Cascadia Code', monoFontFamilySource: 'user' } });
});

it('startup refresh preserves unknown and explicit font choices', async () => {
  const { settings, fonts, setDurable } = await setup();
  setDurable({ ...settings.getState().settings, revision: 1, typography: { ...settings.getState().settings.typography, monoFontFamily: 'Consolas', monoFontFamilyZh: 'Microsoft YaHei', monoFontFamilySource: 'legacy', monoFontFamilyZhSource: 'user' } });
  await fonts.getState()._applyStatus(ready);
  expect(mocks.apply).toHaveBeenCalledWith(undefined);
  expect(settings.getState().settings.typography).toMatchObject({ monoFontFamily: 'Consolas', monoFontFamilyZh: 'Microsoft YaHei' });
});

it('a failed download leaves existing font settings untouched', async () => {
  const { settings, fonts } = await setup();
  await settings.getState().setTypography({ monoFontFamily: 'Cascadia Mono' });
  const before = structuredClone(settings.getState().settings.typography);
  mocks.download.mockRejectedValue(new Error('offline'));
  expect(await fonts.getState().download()).toBeNull();
  expect(settings.getState().settings.typography).toEqual(before);
  expect(mocks.apply).not.toHaveBeenCalled();
});

it('a settings write failure does not misclassify a valid installed font pack as damaged', async () => {
  const { fonts } = await setup();
  mocks.apply.mockRejectedValue(new Error('disk full'));
  await fonts.getState()._applyStatus(ready);
  expect(fonts.getState().status?.state).toBe('ready');
  expect(fonts.getState().error).toContain('字体设置保存失败');
});
