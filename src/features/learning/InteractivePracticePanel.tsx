import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Check, ChevronDown, ChevronUp, ListChecks, RotateCcw, X } from 'lucide-react';
import { usePracticeStore } from './practiceStore';
import { PRACTICE_TASKS } from './practiceCourse';
import { findPracticeText, observePracticeTask, ownsPracticeEditor } from './practiceDetection';
import { useWindowStore } from '../../stores/windowStore';
import './interactivePractice.css';

export interface InteractivePracticePanelProps {
  activeEditor: Editor | null;
  activeKey: string | null;
}

export function InteractivePracticePanel({ activeEditor, activeKey }: InteractivePracticePanelProps) {
  const session = usePracticeStore();
  const [collapsed, setCollapsed] = useState(false);
  const [left, setLeft] = useState(false);
  const [historyUndone, setHistoryUndone] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const index = PRACTICE_TASKS.findIndex(task => task.id === session.stepId);
  const task = PRACTICE_TASKS[index];
  const finished = session.stepId === 'summary';
  const completed = session.completed.includes(session.stepId);
  const visible = !!session.sessionKey && activeKey === session.sessionKey;
  const editorReady = ownsPracticeEditor(activeEditor, session.sessionKey);

  useEffect(() => { setCollapsed(false); setError(''); }, [session.sessionKey]);
  useEffect(() => {
    setHistoryUndone(false);
    if (!session.sessionKey || completed || !task) return;
    const key = session.sessionKey, id = task.id;
    return observePracticeTask({ editor: activeEditor, activeKey, sessionKey: key, stepId: id,
      current: () => {
        const state = usePracticeStore.getState();
        return state.sessionKey === key && state.stepId === id && useWindowStore.getState().activeKey === key;
      },
      onComplete: () => usePracticeStore.getState().complete(key, id),
      onHistoryProgress: setHistoryUndone,
    });
  }, [activeEditor, activeKey, session.sessionKey, session.stepId, completed, task]);

  if (!visible || (!task && !finished)) return null;
  const next = () => session.selectStep(PRACTICE_TASKS[index + 1]?.id ?? 'summary');
  const skip = () => { session.skip(session.stepId); next(); };
  const locate = () => {
    if (!editorReady || !task?.target) return;
    const range = findPracticeText(activeEditor.state.doc, task.target);
    if (!range) { setError('这段内容已被改动，可以在正文继续练习或跳过此项。'); return; }
    const dom = activeEditor.view.domAtPos(range.from).node;
    const element = dom instanceof Element ? dom : dom.parentElement;
    element?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    setError('');
  };
  const restart = async () => {
    if (restarting) return;
    setRestarting(true); setError('');
    try { const { startInteractivePractice } = await import('./startInteractivePractice'); await startInteractivePractice({ fresh: true }); }
    catch { setError('练习副本暂时无法创建，请稍后再试。'); }
    finally { setRestarting(false); }
  };

  return <aside className={`nb-practice-panel${left ? ' nb-practice-panel--left' : ''}${collapsed ? ' nb-practice-panel--collapsed' : ''}`} aria-label="互动练习">
    <header className="nb-practice-header">
      <span className="nb-practice-label">互动练习</span>
      <span className="nb-practice-counter">{finished ? '练习回顾' : `${index + 1} / ${PRACTICE_TASKS.length}`}</span>
      <button type="button" className="nb-practice-icon" aria-label={collapsed ? '展开练习任务' : '收起练习任务'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>
      <button type="button" className="nb-practice-icon" aria-label="退出练习" onClick={session.exit}><X size={16}/></button>
    </header>
    {!collapsed && <div className="nb-practice-body">
      {finished ? <>
        <h2>你的笔记已经有了新变化</h2>
        <p>完成 {session.completed.length} 项，跳过 {session.skipped.length} 项。练习文档可以继续编辑，也可以保存。</p>
        <p className="nb-practice-hint">接下来可以点击窗口上方的导出按钮（Ctrl + E），让这份笔记成为网页或 PDF。</p>
      </> : <>
        <span className="nb-practice-group">{task.group}</span>
        <h2>{task.title}</h2>
        <p className="nb-practice-instruction">{task.instruction}</p>
        <p className="nb-practice-hint">{task.hint}</p>
        <div className={`nb-practice-status${completed ? ' nb-practice-status--complete' : ''}`} role="status" aria-live="polite">
          {completed ? <><Check size={15}/>已完成，准备好后继续</> : historyUndone ? '已撤销，现在重做让修改恢复' : !editorReady ? '切回可视化编辑即可继续' : '在正文中试一试'}
        </div>
        {task.target && <button type="button" className="nb-practice-link" disabled={!editorReady} onClick={locate}>定位练习内容</button>}
      </>}
      {error && <p className="nb-practice-error" role="alert">{error}</p>}
      <details className="nb-practice-course">
        <summary><ListChecks size={15}/>练习清单<span>{session.completed.length} 项完成</span></summary>
        <ol>{PRACTICE_TASKS.map((item, at) => <li key={item.id}>
          <button type="button" aria-current={item.id === session.stepId ? 'step' : undefined} onClick={() => session.selectStep(item.id)}>
            <span className="nb-practice-task-number">{session.completed.includes(item.id) ? <Check size={13}/> : at + 1}</span>
            <span>{item.title}</span><span className="nb-practice-task-state">{session.completed.includes(item.id) ? '完成' : session.skipped.includes(item.id) ? '跳过' : ''}</span>
          </button>
        </li>)}</ol>
      </details>
      <footer className="nb-practice-footer">
        {finished ? <button type="button" className="nb-practice-primary" onClick={session.exit}>结束练习</button> : <>
          <button type="button" className="nb-practice-secondary" onClick={skip}>跳过此项</button>
          <button type="button" className="nb-practice-primary" disabled={!completed} onClick={next}>{index === PRACTICE_TASKS.length - 1 ? '查看回顾' : '继续'}</button>
        </>}
      </footer>
      <div className="nb-practice-options">
        <button type="button" onClick={() => setLeft(value => !value)}>{left ? '移到右侧' : '移到左侧'}</button>
        <button type="button" disabled={restarting} onClick={() => void restart()}><RotateCcw size={12}/>{restarting ? '正在创建…' : '重新练习'}</button>
      </div>
    </div>}
  </aside>;
}
export default InteractivePracticePanel;
