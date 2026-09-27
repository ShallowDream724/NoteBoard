import { renderImageEdit } from './renderer';
import type { ImageEditRecipe } from './model';
import type { ImageExportMimeType } from './exporter';
import type { ImageResource } from './resources';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{ blob: Blob; recipe: ImageEditRecipe; width: number; height: number; mimeType: ImageExportMimeType; quality?: number }>) => {
  let image: ImageBitmap | null = null, canvas: OffscreenCanvas | null = null;
  try {
    const { blob, recipe, width, height, mimeType, quality } = event.data;
    image = await createImageBitmap(blob);
    if (image.width !== recipe.sourceWidth || image.height !== recipe.sourceHeight) throw new Error('原图尺寸已变化，请重新打开编辑器');
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建导出画布，请释放内存后重试，或主动选择较小的导出尺寸');
    const resource: ImageResource = { image, width: image.width, height: image.height, pixelWidth: image.width, pixelHeight: image.height, disposed: false, getBlob: () => blob, getOriginal: async () => { throw new Error('导出资源已经是原图'); }, dispose: () => {} };
    renderImageEdit(context, resource, recipe, { width, height, background: mimeType === 'image/jpeg' ? '#ffffff' : undefined });
    const result = await canvas.convertToBlob({ type: mimeType, quality });
    if (!result.size) throw new Error('图片编码失败，可能超出当前设备容量');
    if (result.type !== mimeType) throw new Error('当前浏览器不支持所选导出格式，请选择 PNG');
    scope.postMessage({ blob: result });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : '图片导出失败' });
  } finally {
    image?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
};
