// NoteBoard settingsStore
// 跨窗口同步的唯一 store
// 详见 docs/architecture/settings-and-updates.md

import { create } from 'zustand';
import type {
  Settings,
  SettingsPatch,
  ThemeId,
  ThemeMode,
  TypographySettings,
  EditorSettings,
  FileSettings,
  LayoutSettings,
  ExportSettings,
  UpdateSettings,
} from '../core/ipc/types';
import * as ipc from '../core/ipc/commands';
import { onSettingsChanged } from '../core/ipc/events';
import {
  resolveTheme,
  applyTheme,
  applyTypography,
  startSystemThemeListener,
  stopSystemThemeListener,
} from '../core/theme/applyTheme';
import { useFontPackStore } from './fontPackStore';
import { ensureFaces } from '../app/fontPack';
import { setShortcutOverrides, type ShortcutOverrides } from '../core/shortcutBindings';

// ── 默认值 ──

const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  revision: 0,
  shortcuts: { overrides: {} },
  appearance: {
    themeMode: 'system',
    systemLightTheme: 'chen-guang',
    systemDarkTheme: 'mo-ye',
  },
  typography: {
    contentFontFamily: '',
    contentFontFamilyZh: '',
    monoFontFamily: 'JetBrains Mono',
    monoFontFamilyZh: 'Maple Mono Normal NF CN',
    monoFontFamilySource: 'automatic',
    monoFontFamilyZhSource: 'automatic',
    contentFontSize: 16,
    monoFontSize: 14,
    contentLineHeight: 1.7,
    monoLineHeight: 1.5,
    contentWidth: 'wide',
    monoContentWidth: 'full',
    explorerFontFamily: '',
    explorerFontFamilyZh: '',
    explorerFontSize: 13,
    explorerLineHeight: 24,
    uiFontFamily: '',
    uiFontFamilyZh: '',
    uiFontSize: 13,
  },
  editor: {
    pureMarkdown: false,
    defaultViewMode: 'visual',
    softWrap: true,
    showLineNumbers: true,
    showIndentGuides: true,
    tabSize: 2,
    insertSpaces: true,
    enableMath: true,
    enableMermaid: true,
    enableAlerts: true,
    enableBlockHandle: true,
    showWhitespace: false,
    showLineEndings: false,
  },
  file: {
    autoSaveMarkdown: false,
    autoSaveBoard: false,
    autoSaveOther: false,
    forceManualSave: false,
    showHiddenFiles: false,
    restoreSession: true,
    imageDirName: 'img',
    imageDeletionPolicy: 'ask',
    imageCaptionDeletionPolicy: 'ask',
    largeFileConfirmMb: 50,
    // Rust 不可用时以空值降级；桌面端正常加载后会得到绝对默认路径。
    stagingDirectory: '',
  },
  layout: {
    statusBarVisible: true,
    uiScale: 100,
  },
};

// ── Store 类型 ──

interface SettingsStore {
  /** 全量设置（从 Rust 加载） */
  settings: Settings;
  /** 当前已解析的主题 ID（system → 实际值） */
  resolvedTheme: ThemeId;
  /** 是否已初始化 */
  initialized: boolean;
  /** Failed writes are rolled back; this remains until the next explicit edit. */
  saveError: string | null;

  // ── 初始化 ──
  init: () => Promise<void>;

  // ── 主题 ──
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setSystemLightTheme: (theme: ThemeId) => Promise<void>;
  setSystemDarkTheme: (theme: ThemeId) => Promise<void>;

  // ── 排版 ──
  setTypography: (patch: Partial<TypographySettings>) => Promise<void>;
  resetTypography: () => Promise<void>;
  applyRecommendedFonts: (expected?: TypographySettings) => Promise<void>;

  // ── 编辑器 ──
  setEditor: (patch: Partial<EditorSettings>) => Promise<void>;

  // ── 文件 ──
  setFile: (patch: Partial<FileSettings>) => Promise<void>;

  // ── 布局 ──
  setLayout: (patch: Partial<LayoutSettings>) => Promise<void>;
  setExport: (patch: Partial<ExportSettings>) => Promise<void>;
  setUpdates: (patch: Partial<UpdateSettings>) => Promise<void>;
  setShortcuts: (overrides: ShortcutOverrides) => Promise<void>;

  // ── 内部：从广播更新 ──
  _applyRemoteUpdate: (s: Settings) => void;
}

// ── 创建 store ──

function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  return {
    ...settings,
    ...(patch.appearance && { appearance: { ...settings.appearance, ...patch.appearance } }),
    ...(patch.typography && { typography: { ...settings.typography, ...patch.typography } }),
    ...(patch.editor && { editor: { ...settings.editor, ...patch.editor } }),
    ...(patch.file && { file: { ...settings.file, ...patch.file } }),
    ...(patch.layout && { layout: { ...settings.layout, ...patch.layout } }),
    ...(patch.export && { export: { pandocPath: '', ...settings.export, ...patch.export } }),
    ...(patch.updates && { updates: { ignoredVersion: '', ...settings.updates, ...patch.updates } }),
    ...(patch.shortcuts && { shortcuts: { overrides: { ...settings.shortcuts?.overrides, ...patch.shortcuts.overrides } } }),
  };
}

/** Confirmed server state plus local intent, independent of arrival order. */
export class SettingsReplica {
  private confirmed: Settings;
  private received = false;
  private sequence = 0;
  private pending: Array<{ id: number; patch: SettingsPatch }> = [];
  constructor(initial: Settings) { this.confirmed = initial; }
  enqueue(patch: SettingsPatch) { const id = ++this.sequence; this.pending.push({ id, patch }); return id; }
  receive(snapshot: Settings) {
    if (snapshot.revision > this.confirmed.revision || (!this.received && snapshot.revision === this.confirmed.revision)) {
      this.confirmed = snapshot; this.received = true;
    }
  }
  settle(id: number, snapshot?: Settings) {
    if (snapshot) this.receive(snapshot);
    this.pending = this.pending.filter(entry => entry.id !== id);
  }
  view() { return this.pending.reduce((settings, entry) => applyPatch(settings, entry.patch), this.confirmed); }
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const replica = new SettingsReplica(DEFAULT_SETTINGS);
  let initialization: Promise<void> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let themeBinding = '';
  const publish = (force = false) => {
    const settings = replica.view(), previous = get().settings;
    const appearanceChanged = settings.appearance !== previous.appearance;
    let resolvedTheme = get().resolvedTheme;
    if (force || appearanceChanged) {
      resolvedTheme = resolveTheme(settings.appearance.themeMode, settings.appearance.systemLightTheme, settings.appearance.systemDarkTheme);
      applyTheme(resolvedTheme);
    }
    if (force || settings.typography !== previous.typography) applyTypography(settings.typography);
    if (force || settings.shortcuts !== previous.shortcuts) setShortcutOverrides(settings.shortcuts?.overrides ?? {});
    set({ settings, resolvedTheme });
    const { themeMode, systemLightTheme, systemDarkTheme } = settings.appearance;
    const binding = `${themeMode}:${systemLightTheme}:${systemDarkTheme}`;
    if ((force || appearanceChanged) && binding !== themeBinding) {
      themeBinding = binding; stopSystemThemeListener();
      if (themeMode === 'system') startSystemThemeListener(
        () => get().settings.appearance.themeMode === 'system', systemLightTheme, systemDarkTheme,
        resolvedTheme => set({ resolvedTheme }),
      );
    }
    if (settings.file !== previous.file) void import('./documentStore').then(({ useDocumentStore }) => {
      useDocumentStore.getState().syncSavePolicies();
    }).catch(() => {});
  };
  const submit = (input: SettingsPatch): Promise<string | null> => {
    // Snapshot caller intent once; later UI mutations cannot change queued IPC.
    const patch = JSON.parse(JSON.stringify(input)) as SettingsPatch;
    const id = replica.enqueue(patch); set({ saveError: null }); publish();
    const saved = tail.then(async () => {
      try {
        const snapshot = await ipc.patchSettings(patch);
        replica.settle(id, snapshot); publish();
      } catch (error) {
        const message = String(error);
        replica.settle(id); publish(); set({ saveError: message });
        return message;
      }
      if (patch.file?.restoreSession === false) {
        try { await ipc.clearSession(); }
        catch (error) { const message = `设置已保存，但清理旧窗口记录失败：${String(error)}`; set({ saveError: message }); return message; }
      }
      return null;
    });
    tail = saved.then(() => {});
    return saved;
  };
  const update = async (patch: SettingsPatch) => { await submit(patch); };
  return {
    setShortcuts: async overrides => { const error = await submit({ shortcuts: { overrides } }); if (error) throw new Error(error); },
    settings: DEFAULT_SETTINGS, resolvedTheme: 'chen-guang', initialized: false, saveError: null,
    init: () => {
      if (initialization) return initialization;
      initialization = (async () => {
        // Register first: a broadcast during load is merged before its snapshot,
        // and an older load response can never replace a newer revision.
        try { await onSettingsChanged(remote => get()._applyRemoteUpdate(remote)); }
        catch (error) { set({ saveError: `设置同步监听失败：${String(error)}` }); }
        try { replica.receive(await ipc.loadSettings()); }
        catch (error) { set({ saveError: `加载设置失败：${String(error)}` }); }
        publish(true); set({ initialized: true });
        void useFontPackStore.getState().init().catch(error => console.error('字体服务初始化失败:', error));
      })();
      return initialization;
    },
    setThemeMode: mode => update({ appearance: { themeMode: mode } }),
    setSystemLightTheme: theme => update({ appearance: { systemLightTheme: theme } }),
    setSystemDarkTheme: theme => update({ appearance: { systemDarkTheme: theme } }),
    setTypography: typography => update({ typography: {
      ...typography,
      ...('monoFontFamily' in typography && !typography.monoFontFamilySource && { monoFontFamilySource: 'user' }),
      ...('monoFontFamilyZh' in typography && !typography.monoFontFamilyZhSource && { monoFontFamilyZhSource: 'user' }),
    } }),
    applyRecommendedFonts: expected => {
      // Use the native transaction to avoid overwriting another window's newer font choice.
      if (expected) set({ saveError: null });
      const saved = tail.then(async () => {
        try {
          replica.receive(await ipc.applyRecommendedFonts(expected));
          publish();
        } catch (error) {
          set({ saveError: String(error) });
          throw error;
        }
      });
      tail = saved.catch(() => {});
      return saved.then(() => ensureFaces(get().settings.typography));
    },
    resetTypography: async () => {
      const typography = await ipc.defaultTypography();
      const error = await submit({ typography });
      if (error) throw new Error(error);
    },
    setEditor: editor => update({ editor }),
    setFile: file => update({ file }),
    setLayout: layout => update({ layout }),
    setExport: async patch => { const error = await submit({ export: patch }); if (error) throw new Error(error); },
    setUpdates: async patch => { const error = await submit({ updates: patch }); if (error) throw new Error(error); },
    _applyRemoteUpdate: remote => { replica.receive(remote); publish(); },
  };
});
