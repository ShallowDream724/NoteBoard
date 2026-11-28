import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { on, off } from '../../core/emitter';
import { sameKey } from '../explorer/pathUtils';
import { scaleImageAt, useImageWheelGesture, type ImageTransform } from '../image-viewer/imageWheelGesture';

const FIT: ImageTransform = { scale: 1, x: 0, y: 0 };
const MIN_ZOOM = .125;
const MAX_ZOOM = 20;

export function ImageReference({ filePath, fileName }: { filePath: string; fileName: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [transform, setTransform] = useState(FIT);
  const [dragging, setDragging] = useState(false);
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  useImageWheelGesture(viewport, transform, setTransform, {
    min: MIN_ZOOM, max: MAX_ZOOM, normalWheel: 'pan',
  });

  useEffect(() => {
    const refresh = ({ path }: { path: string }) => {
      if (!sameKey(path, filePath)) return;
      setFailed(false);
      setVersion(value => value + 1);
    };
    on('image-file-restored', refresh);
    return () => off('image-file-restored', refresh);
  }, [filePath]);

  const url = convertFileSrc(filePath);
  return (
    <div
      className="nb-reference-image"
      role="region"
      aria-label="图片预览"
      tabIndex={0}
      data-dragging={dragging || undefined}
      onDoubleClick={() => setTransform(FIT)}
      onPointerDown={event => {
        if (failed || drag.current || (event.button !== 0 && event.button !== 1)) return;
        if (event.button === 1) event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setDragging(true);
      }}
      onPointerMove={event => {
        const previous = drag.current;
        if (previous?.id !== event.pointerId) return;
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setTransform(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }}
      onLostPointerCapture={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={event => {
        if (failed || !(event.ctrlKey || event.metaKey) || event.altKey) return;
        if (!['0', '+', '=', '-'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === '0') {
          setTransform(FIT);
          return;
        }
        const factor = event.key === '-' ? 1 / 1.25 : 1.25;
        setTransform(current => scaleImageAt(current,
          Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor)), { x: 0, y: 0 }));
      }}
      ref={viewport}
    >
      {failed ? (
        <p className="nb-reference-message" role="alert">无法显示图片</p>
      ) : (
        <img src={version ? `${url}?reference=${version}` : url} alt={fileName} draggable={false}
          onError={() => setFailed(true)}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
      )}
    </div>
  );
}
