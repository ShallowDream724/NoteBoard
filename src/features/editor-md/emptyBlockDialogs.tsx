import type { Editor } from '@tiptap/core';
import { showTransientDialog } from '../../components/TransientDialog';
import { LinkModal } from './LinkModal';
import { captureEmptyParagraphInsertion } from './emptyBlockInsertion';
import type { InsertedImage, InsertionLease } from './imageInsertionLease';
import { insertLocalImageUsingLease } from './imagePaste';
import { requestImageLink } from './rich-content/imageLinkDialog';

function returnToEditor<T>(editor: Editor, lease: InsertionLease<T>) {
  if (lease.current()) editor.view.focus();
  lease.dispose();
}

export async function insertEmptyParagraphLink(editor: Editor, pos: number): Promise<void> {
  const lease = captureEmptyParagraphInsertion<{ text: string; url: string }>(editor, pos, ({ text, url }) => ({
    type: 'paragraph', content: [{ type: 'text', text: text.trim() || url.trim(), marks: [{ type: 'link', attrs: { href: url.trim() } }] }],
  }));
  if (!lease) return;
  try {
    const value = await showTransientDialog<{ text: string; url: string } | null>(finish =>
      <LinkModal isOpen onClose={() => finish(null)} onConfirm={finish}/>);
    if (value) lease.commit(value);
  } finally { returnToEditor(editor, lease); }
}

export async function insertEmptyParagraphImage(editor: Editor, pos: number, source: 'local' | 'url'): Promise<void> {
  const lease = captureEmptyParagraphInsertion<InsertedImage | InsertedImage[]>(editor, pos, value =>
    (Array.isArray(value) ? value : [value]).map(image => ({ type: 'image', attrs: image })));
  if (!lease) return;
  if (source === 'local') { await insertLocalImageUsingLease({ ...lease, dispose: () => returnToEditor(editor, lease) }); return; }
  try { const url = await requestImageLink(); if (url) lease.commit({ src: url, alt: '' }); }
  finally { returnToEditor(editor, lease); }
}
