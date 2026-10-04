/* global window, localStorage */
/** Offline native boundary for production-bundle browser checks. Editor, menus,
 * history and document stores remain real; this does not test filesystem IPC. */
export async function installBrowserNativeShell(page, { theme = 'chen-guang', uiScale = 100 } = {}) {
  await page.addInitScript(({ theme, uiScale }) => {
    localStorage.setItem('noteboard.introduction-seen', '1');
    const callbacks = new Map(); let callbackId = 0;
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
      convertFileSrc: path => path,
      invoke: async (command, args) => {
        window.__qaIpcCalls.push(command);
        if (command === 'window_listeners_ready') return { startupMode: 'empty', consumerId: 'qa', consumerGeneration: 1 };
        if (command === 'load_settings') return settings;
        if (command === 'get_font_pack_status') return { state: 'ready', faces: [] };
        if (command === 'load_session') return null;
        if (command === 'load_favorites') return { schemaVersion: 1, roots: [] };
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
  }, { theme, uiScale });
}
