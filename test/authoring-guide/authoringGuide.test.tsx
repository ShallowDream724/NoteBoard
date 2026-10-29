import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthoringGuideContent } from '../../src/features/authoring-guide/AuthoringGuide';
import { copyText, exportBlobWithDialog } from '../../src/features/export/chartExport';
import skill from '../../skills/noteboard-authoring/SKILL.md?raw';

vi.mock('../../src/features/export/chartExport', () => ({ copyText: vi.fn(), exportBlobWithDialog: vi.fn() }));

describe('portable authoring guide', () => {
  it('copies and saves the displayed skill; cancellation stays quiet and failures remain actionable', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<AuthoringGuideContent />));
      expect(host.querySelector('textarea')?.value).toBe(skill);
      const buttons = host.querySelectorAll('button');
      await act(async () => buttons[0].click());
      expect(copyText).toHaveBeenCalledWith(skill);
      expect(host.querySelector('[role="status"]')?.textContent).toContain('已复制');
      vi.mocked(exportBlobWithDialog).mockResolvedValueOnce(false);
      await act(async () => buttons[1].click());
      expect(exportBlobWithDialog).toHaveBeenCalledWith(expect.any(Blob), 'SKILL.md', [{ name: 'Markdown', extensions: ['md'] }]);
      expect(host.querySelector('[role="status"]')).toBeNull();
      vi.mocked(exportBlobWithDialog).mockRejectedValueOnce(new Error('磁盘空间不足'));
      await act(async () => buttons[1].click());
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('磁盘空间不足');
      expect(buttons[1].disabled).toBe(false);
    } finally {
      await act(async () => root.unmount()); host.remove();
    }
  });
});
