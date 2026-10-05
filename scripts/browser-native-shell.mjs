/* global window, localStorage, crypto, Blob */
/** Offline native boundary for production-bundle browser checks. Editor, menus,
 * history and document stores remain real; this does not test filesystem IPC. */
export async function installBrowserNativeShell(page, { theme = 'chen-guang', uiScale = 100, introductionSeen = true } = {}) {
  await page.addInitScript(({ theme, uiScale, introductionSeen }) => {
    if (introductionSeen) localStorage.setItem('noteboard.introduction-seen', '1');
    const callbacks = new Map(); let callbackId = 0;
    const images = new Map();
    window.__qaIpcCalls = []; window.__qaStagedDocuments = [];
    const settings = {
      schemaVersion: 1, revision: 0, shortcuts: { overrides: {} },
      appearance: { themeMode: theme, systemLightTheme: 'chen-guang', systemDarkTheme: 'mo-ye' },
      typography: { contentFontFamily: '', contentFontFamilyZh: '', monoFontFamily: 'monospace', monoFontFamilyZh: '', monoFontFamilySource: 'automatic', monoFontFamilyZhSource: 'automatic', contentFontSize: 16, monoFontSize: 14, contentLineHeight: 1.7, monoLineHeight: 1.5, contentWidth: 'wide', monoContentWidth: 'full', explorerFontFamily: '', explorerFontFamilyZh: '', explorerFontSize: 13, explorerLineHeight: 24, uiFontFamily: '', uiFontFamilyZh: '', uiFontSize: 13 },
      editor: { pureMarkdown: false, defaultViewMode: 'visual', softWrap: true, showLineNumbers: true, showIndentGuides: true, tabSize: 2, insertSpaces: true, enableMath: true, enableMermaid: true, enableAlerts: true, enableBlockHandle: true, showWhitespace: false, showLineEndings: false },
      file: { autoSaveMarkdown: false, autoSaveBoard: false, autoSaveOther: false, forceManualSave: false, showHiddenFiles: false, restoreSession: false, imageDirName: 'img', imageDeletionPolicy: 'ask', imageCaptionDeletionPolicy: 'ask', largeFileConfirmMb: 50, stagingDirectory: '' },
      layout: { statusBarVisible: true, uiScale },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'qa' }, currentWebview: { label: 'qa' } },
      transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      convertFileSrc: path => images.get(path.replaceAll('\\', '/')) || path,
      invoke: async (command, args) => {
        window.__qaIpcCalls.push(command);
        if (command === 'window_listeners_ready') return { startupMode: 'empty', consumerId: 'qa', consumerGeneration: 1 };
        if (command === 'load_settings') return settings;
        if (command === 'get_font_pack_status') return { state: 'ready', faces: [] };
        if (command === 'load_session') return null;
        if (command === 'load_favorites') return { schemaVersion: 1, roots: [] };
        if (command === 'ensure_staging_directory') return 'C:/qa';
        if (command === 'store_image_asset') {
          const bytes = new Uint8Array(args);
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
          const name = `${hash}.png`, path = `C:/qa/.noteboard-assets/${name}`;
          if (!images.has(path)) images.set(path, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
          return name;
        }
        if (['list_open_requests', 'list_recent', 'list_drafts', 'get_dismissed_update_notices', 'probe_shortcuts', 'recover_native_commits'].includes(command)) return [];
        if (command === 'stash_documents') {
          window.__qaStagedDocuments = args.documents;
          return args.documents.map(doc => ({ key: doc.key, targetPath: `C:/qa/${doc.displayName}` }));
        }
        if (command === 'plugin:app|version') return '1.0.2';
        if (command === 'plugin:event|listen') return ++callbackId;
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { theme, uiScale, introductionSeen });
}
