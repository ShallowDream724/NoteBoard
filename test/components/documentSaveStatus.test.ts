import { describe, expect, it } from 'vitest';
import { documentSaveStatus } from '@/components/documentSaveStatus';

const doc = { key:'C:\\notes\\a.md',kind:'markdown' as const,readonly:false,isDirty:false,savePolicy:'manual' as const,externalStatus:null };
describe('shared save presentation', () => {
  it('distinguishes unsaved paths, dirty files, in-flight writes and failures', () => {
    expect(documentSaveStatus(doc,false).state).toBe('saved');
    expect(documentSaveStatus({...doc,isDirty:true},false).state).toBe('unsaved');
    expect(documentSaveStatus({...doc,key:'untitled:a'},false).state).toBe('unsaved');
    expect(documentSaveStatus(doc,true).state).toBe('unsaved');
    expect(documentSaveStatus({...doc,externalStatus:'deleted'},false).state).toBe('unsaved');
    expect(documentSaveStatus(doc,false,{pending:1,error:null})).toMatchObject({state:'saving',disabled:true});
    expect(documentSaveStatus(doc,false,{pending:0,error:'磁盘已满'})).toMatchObject({state:'error',description:'磁盘已满',disabled:false});
  });
  it('never offers a write for previews or readonly sources', () => {
    expect(documentSaveStatus(undefined,false)).toMatchObject({visible:false,disabled:true});
    expect(documentSaveStatus({...doc,kind:'image'},false)).toMatchObject({visible:false,disabled:true});
    expect(documentSaveStatus({...doc,readonly:true},false)).toMatchObject({visible:true,disabled:true});
  });
});
