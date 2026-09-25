import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { setBlockType, toggleMark, wrapIn } from '@tiptap/pm/commands';
import { wrapInList } from '@tiptap/pm/schema-list';
import { Bold, ImagePlus, Italic, List, ListOrdered, Quote } from 'lucide-react';
import { Tooltip } from '../../../components/Tooltip';
import { createAnnotationBodyView, updateAnnotationBodyView } from './bodyView';

export interface AnnotationDraftHandle { content(): JSONContent[]; focus(): void }

/** Only an active panel owns a view. Draft history stays local until one parent transaction saves it. */
export function AnnotationBodyEditor({ editor, body, editable, draft }: {
  editor: Editor; body: ProseMirrorNode; editable: boolean;
  draft: MutableRefObject<AnnotationDraftHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const [imageInput, setImageInput] = useState(false), [imageSource, setImageSource] = useState(''), [imageAlt, setImageAlt] = useState('');
  const currentBody = useRef(body); currentBody.current = body;
  useLayoutEffect(() => {
    const bodyView = createAnnotationBodyView(host.current!, editor, currentBody.current, editable);
    view.current = bodyView;
    draft.current = { content: () => bodyView.state.doc.toJSON().content ?? [{ type: 'paragraph' }], focus: () => bodyView.focus() };
    if (editable) bodyView.focus();
    return () => { draft.current = null; view.current = null; bodyView.destroy(); };
  }, [editor, editable, draft]);
  useEffect(() => {
    const current = view.current;
    if (!editable && current) updateAnnotationBodyView(current, body);
  }, [body, editable, editor]);
  const command = (action: 'bold' | 'italic' | 'bulletList' | 'orderedList' | 'blockquote' | 'paragraph' | 'heading') => {
    const current = view.current; if (!current) return;
    const { schema } = current.state;
    const execute = action === 'bold' || action === 'italic' ? toggleMark(schema.marks[action])
      : action === 'bulletList' || action === 'orderedList' ? wrapInList(schema.nodes[action])
      : action === 'blockquote' ? wrapIn(schema.nodes.blockquote)
      : setBlockType(schema.nodes[action], action === 'heading' ? { level: 2 } : undefined);
    execute(current.state, current.dispatch, current); current.focus();
  };
  return <div className="nb-annotation-body" onKeyDown={event => {
    // The draft has its own undo history; parent document shortcuts must not also run.
    if (event.key !== 'Escape' && !((event.ctrlKey || event.metaKey) && event.key === 'Enter')) event.stopPropagation();
  }}>
    {editable && <div className="nb-annotation-format" role="toolbar" aria-label="说明格式">
      {([
        ['bold', '加粗', Bold], ['italic', '斜体', Italic], ['bulletList', '无序列表', List],
        ['orderedList', '有序列表', ListOrdered], ['blockquote', '引用', Quote],
      ] as const).map(([action, label, Icon]) => <Tooltip content={label} key={action}><button type="button" aria-label={label}
        onMouseDown={event => event.preventDefault()} onClick={() => command(action)}><Icon size={14}/></button></Tooltip>)}
      {editor.schema.nodes.image && <Tooltip content="插入图片"><button type="button" aria-label="插入图片" aria-expanded={imageInput}
        onMouseDown={event => event.preventDefault()} onClick={() => setImageInput(value => !value)}><ImagePlus size={14}/></button></Tooltip>}
      <select aria-label="段落样式" defaultValue="paragraph" onChange={event => { command(event.target.value as 'paragraph' | 'heading'); event.target.value = 'paragraph'; }}>
        <option value="paragraph">正文</option><option value="heading">标题</option>
      </select>
    </div>}
    {editable && imageInput && <form className="nb-annotation-image-input" onSubmit={event => {
      event.preventDefault(); const current = view.current, src = imageSource.trim();
      if (!current || !src || /^(javascript|vbscript):/i.test(src)) return;
      current.dispatch(current.state.tr.replaceSelectionWith(current.state.schema.nodes.image.create({ src, alt: imageAlt.trim() || null })));
      setImageInput(false); setImageSource(''); setImageAlt(''); current.focus();
    }}>
      <input autoFocus aria-label="图片地址或相对路径" placeholder="图片地址或相对路径" value={imageSource} onChange={event => setImageSource(event.target.value)}/>
      <div><input aria-label="图片说明" placeholder="图片说明（可选）" value={imageAlt} onChange={event => setImageAlt(event.target.value)}/><button type="submit" disabled={!imageSource.trim()}>插入</button></div>
    </form>}
    <div ref={host}/>
  </div>;
}
