import { expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { defaultTypography, patchSettings } from '../../src/core/ipc/commands';
vi.mock('../../src/core/ipc/commands', () => ({ defaultTypography: vi.fn(), patchSettings: vi.fn() }));
vi.mock('../../src/core/theme/applyTheme', () => ({ applyTypography: vi.fn(), applyTheme: vi.fn(), resolveTheme: () => 'chen-guang', startSystemThemeListener: vi.fn(), stopSystemThemeListener: vi.fn() }));

it('resets the whole typography group from native defaults without replacing unrelated settings', async () => {
  const initial = structuredClone(useSettingsStore.getState().settings);
  let durable = initial;
  vi.mocked(patchSettings).mockImplementation(async patch => {
    durable = { ...durable, revision: durable.revision + 1, typography: { ...durable.typography, ...patch.typography } };
    return durable;
  });
  // Distinct from the fallback: proves the reset actually consumes the native response.
  const nativeDefaults = { ...initial.typography, monoFontFamily: 'Native default family' };
  vi.mocked(defaultTypography).mockResolvedValue(nativeDefaults);
  await useSettingsStore.getState().setTypography({ uiFontSize: 18, contentFontSize: 24, contentWidth: 'full' });
  await useSettingsStore.getState().resetTypography();
  expect(defaultTypography).toHaveBeenCalledOnce();
  expect(patchSettings).toHaveBeenLastCalledWith({ typography: nativeDefaults });
  expect(useSettingsStore.getState().settings.typography).toEqual(nativeDefaults);
  expect(useSettingsStore.getState().settings.file).toEqual(initial.file);
  expect(useSettingsStore.getState().settings.appearance).toEqual(initial.appearance);
});
