import { GalleryHorizontalEnd } from 'lucide-react';
import type { ImageTemplate } from '../features/editor-md/rich-content/commands';

/** Actual divisions distinguish 2, 4, 6 and 9 cells at toolbar sizes. */
export function ImageGridIcon({ columns = 2, rows = 2, size = 16 }: { columns?: number; rows?: number; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    {Array.from({length:Math.max(0,Math.min(6,columns)-1)},(_,i)=><path key={'c'+i} d={`M${3+18*(i+1)/columns} 3v18`}/>)}
    {Array.from({length:Math.max(0,Math.min(6,rows)-1)},(_,i)=><path key={'r'+i} d={`M3 ${3+18*(i+1)/rows}h18`}/>)}
  </svg>;
}
export function ImageTemplateIcon({ template, size = 16 }: { template: ImageTemplate; size?: number }) {
  return template === 'carousel' ? <GalleryHorizontalEnd size={size}/> : <ImageGridIcon size={size}
    columns={template==='vertical2'?1:template===6||template===9?3:2} rows={template==='vertical2'?2:template===2?1:template===9?3:2}/>;
}
