import { createPortal } from 'react-dom';
import { useDocumentStatusSlot, useDocumentStatusTarget } from '../../components/statusbar/documentStatusTarget';
import './imageStatus.css';

export interface ImageSize { width: number; height: number }

function aspectRatio({ width, height }: ImageSize): string {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  const horizontal = width / divisor;
  const vertical = height / divisor;
  return horizontal > 30 || vertical > 30 ? `${(width / height).toFixed(2)}:1` : `${horizontal}:${vertical}`;
}

export function ImageStatusSlot({ documentKey }: { documentKey: string }) {
  const register = useDocumentStatusSlot('image', documentKey);
  return <div key={documentKey} ref={register} className="nb-image-status" role="group" aria-label="图片信息" />;
}

export function ImageStatus({ documentKey, size, scale, format }: {
  documentKey: string;
  size: ImageSize | null;
  scale: number;
  format: string;
}) {
  const target = useDocumentStatusTarget('image', documentKey);
  if (!target) return null;
  return createPortal(<>
    {size && size.width > 0 && size.height > 0 && <>
      <span className="nb-status-field" title="原图分辨率">{size.width} × {size.height} px</span>
      <span className="nb-status-field" title="原图宽高比">{aspectRatio(size)}</span>
      <span className="nb-status-field" title="缩放">{Math.round(scale * 100)}%</span>
    </>}
    <span className="nb-status-field" title="图像类型">{format}</span>
  </>, target);
}
