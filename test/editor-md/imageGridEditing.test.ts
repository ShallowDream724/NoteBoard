import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { parseNativeNode, serializeNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { resizeImageGrid } from '@/features/editor-md/rich-content/gridEditing';
import { imageCollectionTemplate } from '@/features/editor-md/rich-content/commands';
import { resizeImageGridItems } from '@/core/document/imageGrid';
import { projectRichContent } from '@/features/export/richProjection';
const editors:Editor[]=[];
afterEach(()=>editors.splice(0).forEach(e=>e.destroy()));
function create(){const editor=new Editor({extensions:buildDocumentExtensions(),content:{type:'doc',content:[{type:'imageCollection',attrs:{columns:2,width:'50%',align:'right'},content:['A','B','C','D'].map(text=>({type:'imageSlot',content:[{type:'image',attrs:{src:text+'.png'}},{type:'paragraph',content:[{type:'text',text,marks:[{type:'bold'}]}]}]}))}]}});editors.push(editor);return editor;}
describe('editable image grid shape',()=>{
  it('removes the right column without swapping the remaining vertical pair, and undoes in one step',()=>{
    const editor=create(),before=editor.state.doc;
    expect(resizeImageGrid(editor,0,1,2)).toBe(true);
    expect(editor.state.doc.textContent).toBe('AC');expect(editor.state.doc.firstChild!.attrs).toMatchObject({columns:1,width:'50%',align:'right'});
    expect(editor.state.doc.firstChild!.lastChild!.lastChild!.firstChild!.marks[0].type.name).toBe('bold');
    editor.commands.undo();expect(editor.state.doc.eq(before)).toBe(true);editor.commands.redo();expect(editor.state.doc.textContent).toBe('AC');
    const doc=parseNativeNode(serializeNativeNode(editor.state.doc),editor.schema);expect(doc.eq(editor.state.doc)).toBe(true);
  });
  it('adds a column or row in-place, preserving each image and caption coordinate',()=>{
    const editor=create();resizeImageGrid(editor,0,3,2);
    expect(Array.from({length:6},(_,i)=>editor.state.doc.firstChild!.child(i).textContent)).toEqual(['A','B','','C','D','']);
    resizeImageGrid(editor,0,3,3);expect(editor.state.doc.firstChild!.childCount).toBe(9);expect(editor.state.doc.textContent).toBe('ABCD');
    expect(resizeImageGrid(editor,0,7,3)).toBe(false);expect(resizeImageGrid(editor,0,3,0)).toBe(false);expect(resizeImageGrid(editor,0,6,1000000)).toBe(false);
  });
  it('keeps both two-cell orientations and exports arbitrary supported columns',()=>{
    expect(imageCollectionTemplate(2)).toMatchObject({attrs:{columns:2},content:[{type:'imageSlot'},{type:'imageSlot'}]});
    expect(imageCollectionTemplate('vertical2')).toMatchObject({attrs:{columns:1}});
    const editor=create();resizeImageGrid(editor,0,4,2);
    const projected=projectRichContent(editor.getJSON(),'portable').document;
    expect(projected.content![0].content).toHaveLength(2);expect(projected.content![0].content![0].content).toHaveLength(4);
  });
  it('bounds allocation before expanding hostile dimensions and pads an old incomplete row on demand',()=>{
    expect(resizeImageGridItems([1,2,3],2,2,2,()=>0)).toEqual([1,2,3,0]);
    expect(resizeImageGridItems([1],1,6,Infinity,()=>0)).toBeNull();
  });
});
