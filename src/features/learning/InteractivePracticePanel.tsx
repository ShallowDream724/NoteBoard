import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { Check, X } from 'lucide-react';
import { usePracticeStore } from './practiceStore';
import { GUIDE_STEPS } from './practiceCourse';
import { guideCalloutCount, guideTaskSatisfied, ownsPracticeEditor } from './practiceDetection';
import { guideArrow, placeGuideCard, unionRects, type GuideRect } from './guideGeometry';
import { guideUICompleted, resolveGuideTarget, visibleGuideElement } from './guideTargets';
import { useWindowStore } from '../../stores/windowStore';
import './interactivePractice.css';

export interface InteractivePracticePanelProps { activeEditor: Editor | null; activeKey: string | null }
interface Placement { rects: GuideRect[]; card: GuideRect; target: GuideRect | null; fallback?: 'selection' | 'command'; blocked: boolean }
const emptyPlacement: Placement = { rects: [], card: { left: 12, top: 100, width: 290, height: 200 }, target: null, blocked: true };

/** One scoped observer for one active sample. All overlay pixels ignore pointer input. */
export function InteractivePracticePanel({ activeEditor, activeKey }: InteractivePracticePanelProps) {
  const session = usePracticeStore(), card = useRef<HTMLDivElement>(null), id = useId().replace(/:/g, '');
  const baseline = useRef<{ generation: number; callouts: number } | null>(null);
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const index = GUIDE_STEPS.findIndex(step => step.id === session.stepId), step = GUIDE_STEPS[index];
  const summary = session.stepId === 'summary', completed = session.completed.includes(session.stepId);
  const active = !!session.sessionKey && activeKey === session.sessionKey && ownsPracticeEditor(activeEditor, session.sessionKey);
  const next = () => session.selectStep(GUIDE_STEPS[index + 1]?.id ?? 'summary');

  useEffect(() => {
    if (!active || !activeEditor || !session.sessionKey) return;
    const editor = activeEditor, key = session.sessionKey, stepId = session.stepId, generation = session.generation;
    if (baseline.current?.generation !== generation) baseline.current = { generation, callouts: guideCalloutCount(editor.state.doc) };
    let alive = true, frame = 0, initialScroll = true, lastGeometry = '';
    let checkedDocument: typeof editor.state.doc | null = null, checkedSelection: typeof editor.state.selection | null = null;
    const current = () => alive && !editor.isDestroyed && usePracticeStore.getState().generation === generation && usePracticeStore.getState().sessionKey === key && usePracticeStore.getState().stepId === stepId && useWindowStore.getState().activeKey === key;
    const measure = () => {
      frame = 0; if (!current()) return;
      const modal = visibleGuideElement('[aria-modal="true"]');
      const target = resolveGuideTarget(editor, stepId), box = unionRects(target.rects);
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const contentTarget = !!target.element && editor.view.dom.contains(target.element), topBoundary = contentTarget ? 76 : 4;
      if (!modal && initialScroll && contentTarget && target.element && box) {
        initialScroll = false;
        if (box.top < 90 || box.top + box.height > viewport.height - 32) {
          target.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
          schedule(); return;
        }
      }
      const rects = target.rects.filter(r => r.width > 0 && r.height > 0 && r.top < viewport.height - 24 && r.top + r.height > topBoundary && r.left < viewport.width && r.left + r.width > 0)
        .map(r => ({ left: Math.max(4, r.left), top: Math.max(topBoundary, r.top), width: Math.max(1, Math.min(viewport.width - 4, r.left + r.width) - Math.max(4, r.left)), height: Math.max(1, Math.min(viewport.height - 24, r.top + r.height) - Math.max(topBoundary, r.top)) }));
      const anchor = unionRects(rects);
      const obstacles = Array.from(document.querySelectorAll<HTMLElement>('.nb-annotation-panel,[role="toolbar"].nb-editor-selection-toolbar')).map(element => {
        const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const size = { width: Math.min(290, viewport.width - 24), height: card.current?.offsetHeight ?? 210 };
      const nextPlacement: Placement = { rects, target: anchor, fallback: target.fallback, blocked: !!modal,
        card: placeGuideCard(anchor ?? { left: viewport.width / 2, top: 90, width: 0, height: 0 }, size, viewport, obstacles) };
      const signature = JSON.stringify(nextPlacement);
      if (signature !== lastGeometry) { lastGeometry = signature; setPlacement(nextPlacement); }
      if (!modal && !completed) {
        const changed = checkedDocument !== editor.state.doc || stepId === 'selection' && checkedSelection !== editor.state.selection;
        checkedDocument = editor.state.doc; checkedSelection = editor.state.selection;
        if (guideUICompleted(editor, stepId) || changed && guideTaskSatisfied(stepId, editor.state, baseline.current!.callouts)) usePracticeStore.getState().complete(key, stepId);
      }
    };
    const schedule = () => { if (current() && !frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.nb-onboarding-layer'))) schedule();
    });
    // NodeViews and portals expose real visible state. Attribute filtering avoids
    // reacting to animations; document edits are already coalesced by transaction.
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open', 'data-shortcuts-suspended', 'aria-expanded'] });
    const resize = new ResizeObserver(schedule); resize.observe(editor.view.dom); if (card.current) resize.observe(card.current);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    editor.on('transaction', schedule); editor.on('destroy', schedule);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) usePracticeStore.getState().exit(); };
    window.addEventListener('keydown', escape);
    void document.fonts?.ready.then(schedule); schedule();
    return () => { alive = false; cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); window.removeEventListener('keydown', escape); editor.off('transaction', schedule); editor.off('destroy', schedule); };
  }, [activeEditor, activeKey, active, session.sessionKey, session.generation, session.stepId, completed]);
  useEffect(() => {
    if (!active || !completed || !step?.autoAdvance) return;
    const timer = setTimeout(() => usePracticeStore.getState().selectStep(GUIDE_STEPS[index + 1]?.id ?? 'summary'), 350);
    return () => clearTimeout(timer);
  }, [active, completed, step, index, session.generation]);

  if (!active || (!step && !summary)) return null;
  const locate = () => { if (activeEditor) resolveGuideTarget(activeEditor, session.stepId).element?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); };
  const arrow = placement.target ? guideArrow(placement.card, placement.target) : null;
  const instruction = !completed && placement.fallback === 'selection' ? '先拖选圈中的文字，再点击浮动工具栏里的“添加说明”。'
    : !completed && placement.fallback === 'command' ? '点击圈出的空行，输入 /note，重新打开命令菜单。' : step?.instruction;
  return createPortal(<div className="nb-onboarding-layer" data-guide-step={session.stepId} style={{ visibility: placement.blocked ? 'hidden' : 'visible' }}>
    <svg className="nb-onboarding-map" aria-hidden="true" focusable="false">
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="var(--editor-accent)" strokeWidth="1.8"/></marker></defs>
      {placement.rects.map((r, index) => <rect key={index} data-guide-spotlight="" x={r.left - 4} y={r.top - 4} width={r.width + 8} height={r.height + 8} rx="5" className="nb-onboarding-ring"/>)}
      {arrow && <path data-guide-arrow="" d={arrow.path} className="nb-onboarding-arrow" markerEnd={`url(#${id}-arrow)`}/>}
    </svg>
    <div ref={card} className="nb-onboarding-card" role="region" aria-label="上手引导" style={{ left: placement.card.left, top: placement.card.top, width: placement.card.width, maxHeight: 'calc(100vh - 24px)' }}>
      <header><span>{summary ? '已经上手了' : `${index + 1} / ${GUIDE_STEPS.length}`}</span><button type="button" aria-label="退出引导" onClick={session.exit}><X size={16}/></button></header>
      <div className="nb-onboarding-copy" aria-live="polite"><h2>{summary ? '继续写你自己的笔记' : step.title}</h2><p>{summary ? '这份示例可以继续修改、保存。往下看看图片、表格和公式，菜单上的讲解也可以随时查看。' : completed ? step.success : instruction}</p></div>
      {!summary && !placement.target && <button type="button" className="nb-onboarding-locate" onClick={locate}>定位到这一步</button>}
      <footer>{!summary && <button type="button" className="nb-onboarding-skip" onClick={() => { session.skip(session.stepId); next(); }}>跳过这步</button>}
        {summary ? <button type="button" className="nb-onboarding-next" onClick={session.exit}>开始使用</button>
          : completed && !step.autoAdvance ? <button type="button" className="nb-onboarding-next" onClick={next}><Check size={14}/>{index === GUIDE_STEPS.length - 1 ? '完成' : '继续'}</button>
          : <span className="nb-onboarding-state">{completed ? '完成' : '试着操作圈出的内容'}</span>}
      </footer>
    </div>
  </div>, document.body);
}
export default InteractivePracticePanel;
