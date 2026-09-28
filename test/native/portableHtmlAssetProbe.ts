import { invoke } from '@tauri-apps/api/core';
import { portableHtmlAssetUrls } from '../../src/features/export/portableHtmlAssets';

declare global {
  interface Window { __assetProbePaths: string[] }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const paths = window.__assetProbePaths;
    const urls = await portableHtmlAssetUrls([paths[0], paths[0], paths[1]]);
    const expected = ['iVBORw0KGgoBAgM=', 'iVBORw0KGgoBAgM=', 'iVBORw0KBAU='];
    const ok = urls.every((url, index) => url === `data:image/png;base64,${expected[index]}`);
    await invoke('probe_result', { result: JSON.stringify({ ok, urls }) });
  } catch (error) {
    await invoke('probe_result', { result: JSON.stringify({ ok: false, error: String(error) }) });
  }
});
