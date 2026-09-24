import { Separator } from 'react-resizable-panels';

/** The Group owns pointer/keyboard resizing; this component owns its appearance. */
export function PanelResizeHandle({ label }: { label: string }) {
  return <Separator className="nb-panel-separator" aria-label={label} />;
}
