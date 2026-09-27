import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sceneIo from '../../src/features/board/sceneIo';
import { BoardSceneMaterializer, BoardSceneRevisionTracker } from '../../src/features/board/sceneMaterializer';
import { clearAllDocumentHistories, getCurrentDocumentHistoryContent, initializeDocumentHistory, recordDocumentChange, redoDocumentHistory, registerDocumentHistoryAdapter, registerHistoryMaterializeHook, undoDocumentHistory } from '../../src/features/history/documentHistory';

function fixture(count = 1): sceneIo.ExcalidrawScene {
  return { ...sceneIo.createEmptyScene(false), elements: Array.from({ length: count }, (_, index) => ({ id: `element-${index}`, type: 'rectangle', x: index, y: 0, version: 1, versionNonce: index, isDeleted: false }) as sceneIo.ExcalidrawScene['elements'][number]) };
}

afterEach(() => { vi.restoreAllMocks(); clearAllDocumentHistories(); });

describe('board scene materialization boundaries', () => {
  it('coalesces 240 mutable drag frames over 10,000 elements into one complete snapshot including image bytes', () => {
    const scene = fixture(10_000);
    scene.files = { image: { id: 'image', created: 1, mimeType: 'image/png', dataURL: `data:image/png;base64,${'a'.repeat(1024 * 1024)}` } };
    const serialize = vi.spyOn(sceneIo, 'serializeScene');
    const signature = vi.spyOn(sceneIo, 'getBoardHistorySignature');
    const commit = vi.fn();
    const materializer = new BoardSceneMaterializer(scene, commit);
    const tracker = new BoardSceneRevisionTracker(scene);
    for (let frame = 1; frame <= 240; frame++) {
      Object.assign(scene.elements[0], { x: frame, version: frame + 1, versionNonce: frame });
      expect(tracker.update(scene)).toBe(true);
      materializer.stage(scene, frame === 1);
    }
    expect(commit).not.toHaveBeenCalled();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(signature).toHaveBeenCalledTimes(1);
    const content = materializer.capture();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(signature).toHaveBeenCalledTimes(2);
    expect(JSON.parse(content).elements[0].x).toBe(240);
    expect(JSON.parse(content).files.image.dataURL).toBe(scene.files.image.dataURL);
    expect(materializer.capture()).toBe(content);
    expect(serialize).toHaveBeenCalledTimes(2);
  });

  it('recognizes in-place edits and reorders but excludes selection/viewport changes', () => {
    const scene = fixture(2);
    const tracker = new BoardSceneRevisionTracker(scene);
    scene.appState = { ...scene.appState, selectedElementIds: { 'element-0': true }, zoom: 2, scrollX: 120 };
    expect(tracker.update(scene)).toBe(false);
    scene.elements.reverse();
    expect(tracker.update(scene)).toBe(true);
    scene.elements[0].isDeleted = true;
    expect(tracker.update(scene)).toBe(true);
    scene.appState.objectsSnapModeEnabled = false;
    expect(tracker.update(scene)).toBe(true);
    expect(tracker.update(scene)).toBe(false);
  });

  it('materializes before immediate undo and preserves the complete redo endpoint', () => {
    const scene = fixture();
    const original = sceneIo.serializeScene(scene);
    initializeDocumentHistory('board', original, 'board');
    const materializer = new BoardSceneMaterializer(scene, (_scene, content, _signature, startsNewGroup) => recordDocumentChange('board', content, { mode: 'board', startsNewGroup }));
    const disposeHook = registerHistoryMaterializeHook(key => { if (key === 'board') materializer.materialize(); });
    const apply = vi.fn();
    const disposeAdapter = registerDocumentHistoryAdapter('board', { applyEntry: apply });
    try {
      scene.elements[0].x = 300;
      scene.elements[0].version++;
      materializer.stage(scene, true);
      expect(undoDocumentHistory('board')).toBe(true);
      expect(apply.mock.calls[0][0].content).toBe(original);
      expect(redoDocumentHistory('board')).toBe(true);
      expect(JSON.parse(getCurrentDocumentHistoryContent('board')!).elements[0].x).toBe(300);
    } finally { disposeHook(); disposeAdapter(); }
  });

  it('keeps capture idempotent after a mid-gesture save and merges subsequent frames into the same group', () => {
    const scene = fixture();
    const commit = vi.fn();
    const materializer = new BoardSceneMaterializer(scene, commit);
    scene.elements[0].version++;
    materializer.stage(scene, true);
    materializer.capture();
    scene.elements[0].version++;
    materializer.stage(scene, false);
    materializer.capture();
    expect(commit.mock.calls.map(call => call[3])).toEqual([true, false]);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
