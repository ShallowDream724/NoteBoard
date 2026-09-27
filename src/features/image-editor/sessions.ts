import { createImageEditHistory, createImageEditRecipe, type ImageEditHistory } from './model';

/** Suspended editors retain recipes only. Sources, decoded images and canvases belong to the visible dialog. */
const drafts = new Map<string, ImageEditHistory>();

export function getImageEditorDraft(key: string): ImageEditHistory | undefined {
  return drafts.get(key);
}

export function acquireImageEditorDraft(key: string, width: number, height: number): ImageEditHistory {
  const existing = drafts.get(key);
  if (existing) {
    if (existing.present.recipe.sourceWidth !== width || existing.present.recipe.sourceHeight !== height) {
      throw new Error('图片尺寸已变化，保留的编辑进度无法应用。请放弃这份进度后重新打开。');
    }
    return existing;
  }
  const history = createImageEditHistory(createImageEditRecipe(width, height));
  drafts.set(key, history);
  return history;
}

export function updateImageEditorDraft(key: string, history: ImageEditHistory): void {
  drafts.set(key, history);
}

export function discardImageEditorDraft(key: string): void {
  drafts.delete(key);
}

export function hasImageEditorDraft(key: string): boolean {
  const history = drafts.get(key);
  if (!history) return false;
  const recipe = history.present.recipe;
  return history.past.length > 0 || recipe.operations.length > 0 || recipe.rotation !== 0 || recipe.flipX || recipe.flipY
    || recipe.crop.x !== 0 || recipe.crop.y !== 0 || recipe.crop.width !== recipe.sourceWidth || recipe.crop.height !== recipe.sourceHeight;
}
