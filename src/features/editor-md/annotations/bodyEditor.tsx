import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import { createAnnotationBodyView, updateAnnotationBodyView } from './bodyView';
import { BodyFormatToolbar } from './BodyFormatToolbar';
import { insertViewImages } from '../imageInsertionLease';
import { getEditingScope, registerExternalEditingScope } from '../editingScope';

export interface AnnotationDraftHandle { content(): JSONContent[]; focus(): void }

/** Only an active panel owns a view. Draft history stays local until one parent transaction saves it. */
export function AnnotationBodyEditor({ editor, body, editable, draft }: {
  editor: Editor; body: ProseMirrorNode; editable: boolean;
  draft: MutableRefObject<AnnotationDraftHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const scope = useRef<(() => void) | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [composing, setComposing] = useState(false);
  const [imageInput, setImageInput] = useState(false), [imageSource, setImageSource] = useState(''), [imageAlt, setImageAlt] = useState('');
  const currentBody = useRef(body); currentBody.current = body;
  const focusDraft = useCallback(() => view.current?.focus(), []);
  const activateScope = () => {
    if (!editable || !view.current) return;
    const active = getEditingScope(editor.view);
    if (active?.kind === 'external' && active.focus === focusDraft) return;
    scope.current?.();
    scope.current = registerExternalEditingScope(editor.view, { focus: focusDraft });
  };
  useLayoutEffect(() => {
    const bodyView = createAnnotationBodyView(host.current!, editor, currentBody.current, editable, setState);
    view.current = bodyView;
    setState(bodyView.state);
    setImageInput(false); setComposing(false);
    if (editable) scope.current = registerExternalEditingScope(editor.view, { focus: focusDraft });
    draft.current = { content: () => bodyView.state.doc.toJSON().content ?? [{ type: 'paragraph' }], focus: () => bodyView.focus() };
    if (editable) bodyView.focus();
    return () => { scope.current?.(); scope.current = null; draft.current = null; view.current = null; bodyView.destroy(); };
  }, [editor, editable, draft, focusDraft]);
  useEffect(() => {
    const current = view.current;
    if (!editable && current) updateAnnotationBodyView(current, body);
  }, [body, editable, editor]);
  return <div className="nb-annotation-body" onFocusCapture={activateScope} onPointerDownCapture={activateScope}
    onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={event => {
    // The draft has its own undo history; parent document shortcuts must not also run.
    if (event.key !== 'Escape' && !((event.ctrlKey || event.metaKey) && event.key === 'Enter')) event.stopPropagation();
  }}>
    {editable && view.current && state && <BodyFormatToolbar view={view.current} state={state} composing={composing} imageInput={imageInput} onImageInput={() => setImageInput(value => !value)}/>}
    {editable && imageInput && <form className="nb-annotation-image-input" onSubmit={event => {
      event.preventDefault(); const current = view.current, src = imageSource.trim();
      if (!current || !src || /^(javascript|vbscript):/i.test(src)) return;
      insertViewImages(current, [{ src, alt: imageAlt.trim() }], current.state.selection);
      setImageInput(false); setImageSource(''); setImageAlt(''); current.focus();
    }}>
      <input autoFocus aria-label="图片地址或相对路径" placeholder="图片地址或相对路径" value={imageSource} onChange={event => setImageSource(event.target.value)}/>
      <div><input aria-label="图片说明" placeholder="图片说明（可选）" value={imageAlt} onChange={event => setImageAlt(event.target.value)}/><button type="submit" disabled={!imageSource.trim()}>插入</button></div>
    </form>}
    <div ref={host}/>
  </div>;
}
