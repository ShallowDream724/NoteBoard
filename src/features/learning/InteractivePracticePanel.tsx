import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { usePracticeStore } from './practiceStore';
import { GUIDE_STEPS } from './practiceCourse';
import { guideCalloutCount, guideTaskSatisfied, ownsPracticeEditor } from './practiceDetection';
import { unionRects, type GuideRect } from './guideGeometry';
import { guideUICompleted, resolveGuideTarget, visibleGuideElement, type GuideTarget } from './guideTargets';
import { useWindowStore } from '../../stores/windowStore';
import { dismissTransientAnnotations } from '../editor-md/annotations/commands';
import './interactivePractice.css';

export interface InteractivePracticePanelProps { activeEditor: Editor | null; activeKey: string | null }
interface Placement { stepId: string; rects: GuideRect[]; target: GuideRect | null; fallback?: GuideTarget['fallback']; blocked: boolean }
const emptyPlacement: Placement = { stepId: '', rects: [], target: null, blocked: true };

/** One scoped observer for one active sample. All overlay pixels ignore pointer input. */
export function InteractivePracticePanel({ activeEditor, activeKey }: InteractivePracticePanelProps) {
  const session = usePracticeStore();
  const baseline = useRef<{ generation: number; callouts: number } | null>(null);
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const index = GUIDE_STEPS.findIndex(step => step.id === session.stepId), step = GUIDE_STEPS[index];
  const completed = session.completed.includes(session.stepId);
  const active = !!session.sessionKey && activeKey === session.sessionKey && ownsPracticeEditor(activeEditor, session.sessionKey);
  const next = () => { const nextStep = GUIDE_STEPS[index + 1]; if (nextStep) session.selectStep(nextStep.id); else session.exit(); };
  // A virtual anchor uses our coalesced measurements. Radix owns collision and
  // the small beak; hover panels never become new placement obstacles.
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => {
    const r = placement.target ?? { left: window.innerWidth / 2, top: 90, width: 0, height: 0 };
    return new DOMRect(r.left, r.top, r.width, r.height);
  } } }), [placement]);

  useEffect(() => {
    if (!active || !activeEditor || !session.sessionKey) return;
    const editor = activeEditor, key = session.sessionKey, stepId = session.stepId, generation = session.generation;
    if (baseline.current?.generation !== generation) baseline.current = { generation, callouts: guideCalloutCount(editor.state.doc) };
    let alive = true, frame = 0, initialScroll = true, lastGeometry = '';
    let observedTarget: HTMLElement | null = null;
    let checkedDocument: typeof editor.state.doc | null = null, checkedSelection: typeof editor.state.selection | null = null;
    const current = () => alive && !editor.isDestroyed && usePracticeStore.getState().generation === generation && usePracticeStore.getState().sessionKey === key && usePracticeStore.getState().stepId === stepId && useWindowStore.getState().activeKey === key;
    const measure = () => {
      frame = 0; if (!current()) return;
      const modal = visibleGuideElement('[aria-modal="true"]');
      if (!modal && !usePracticeStore.getState().completed.includes(stepId)) {
        const changed = checkedDocument !== editor.state.doc || stepId === 'selection' && checkedSelection !== editor.state.selection;
        checkedDocument = editor.state.doc; checkedSelection = editor.state.selection;
        if (guideUICompleted(editor, stepId) || changed && guideTaskSatisfied(stepId, editor.state, baseline.current!.callouts)) {
          usePracticeStore.getState().complete(key, stepId);
          return;
        }
      }
      if (usePracticeStore.getState().completed.includes(stepId)) return;
      const target = resolveGuideTarget(editor, stepId), box = unionRects(target.rects);
      if (target.element !== observedTarget) {
        if (observedTarget && observedTarget !== editor.view.dom) resize.unobserve(observedTarget);
        observedTarget = target.element;
        if (observedTarget && observedTarget !== editor.view.dom) resize.observe(observedTarget);
      }
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
      const nextPlacement: Placement = { stepId, rects, target: anchor, fallback: target.fallback, blocked: !!modal };
      const signature = JSON.stringify(nextPlacement);
      if (signature !== lastGeometry) { lastGeometry = signature; setPlacement(nextPlacement); }
    };
    const schedule = () => { if (current() && !frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.nb-onboarding-layer'))) schedule();
    });
    // NodeViews and portals expose real visible state. Attribute filtering avoids
    // reacting to animations; document edits are already coalesced by transaction.
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open', 'data-shortcuts-suspended', 'aria-expanded'] });
    const resize = new ResizeObserver(schedule); resize.observe(editor.view.dom);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    editor.on('transaction', schedule); editor.on('destroy', schedule);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) usePracticeStore.getState().exit(); };
    window.addEventListener('keydown', escape);
    void document.fonts?.ready.then(schedule); schedule();
    return () => { alive = false; cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); window.removeEventListener('keydown', escape); editor.off('transaction', schedule); editor.off('destroy', schedule); };
  }, [activeEditor, activeKey, active, session.sessionKey, session.generation, session.stepId]);
  useEffect(() => {
    if (!active || !completed || !step) return;
    const generation = session.generation, key = session.sessionKey;
    const timer = setTimeout(() => {
      const current = usePracticeStore.getState();
      if (current.generation !== generation || current.sessionKey !== key || current.stepId !== step.id || useWindowStore.getState().activeKey !== key || !ownsPracticeEditor(activeEditor, key)) return;
      if (step.id === 'annotation-save') dismissTransientAnnotations(activeEditor);
      const nextStep = GUIDE_STEPS[index + 1];
      if (nextStep) current.selectStep(nextStep.id); else current.exit();
    }, step.settleMs ?? 350);
    return () => clearTimeout(timer);
  }, [active, activeEditor, completed, step, index, session.generation, session.sessionKey]);

  if (!active || !step) return null;
  const locate = () => { if (activeEditor) resolveGuideTarget(activeEditor, session.stepId).element?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); };
  const instruction = placement.fallback === 'selection' ? '拖选这几个字，就能在浮动工具栏里找到“添加说明”。'
    : placement.fallback === 'annotation' ? '说明编辑区已经收起。这个问号按钮可以再次打开它。'
    : placement.fallback === 'command' ? '在这行输入 /note，可以再次找到 Note 提示块。' : step.instruction;
  const visible = !completed && !placement.blocked && placement.stepId === session.stepId;
  return createPortal(<div className="nb-onboarding-layer" data-guide-step={session.stepId} data-guide-completed={completed || undefined}>
    {visible && <>
    <svg className="nb-onboarding-map" aria-hidden="true" focusable="false">
      {placement.rects.map((r, index) => <rect key={index} data-guide-spotlight="" x={r.left - 4} y={r.top - 4} width={r.width + 8} height={r.height + 8} rx="5" className="nb-onboarding-ring"/>)}
    </svg>
    <Popover.Root open modal={false}>
      <Popover.Anchor virtualRef={anchor}/>
      <Popover.Content className="nb-onboarding-card" role="region" aria-label="上手引导" side="top" sideOffset={10} collisionPadding={12} arrowPadding={16}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={session.exit}>
        <header><span>{index + 1} / {GUIDE_STEPS.length}</span><button type="button" aria-label="退出引导" onClick={session.exit}><X size={16}/></button></header>
        <div className="nb-onboarding-copy" aria-live="polite"><h2>{step.title}</h2><p>{instruction}</p></div>
        {!placement.target && <button type="button" className="nb-onboarding-locate" onClick={locate}>定位到这一步</button>}
        <footer><button type="button" className="nb-onboarding-skip" onClick={() => { session.skip(session.stepId); next(); }}>跳过这步</button></footer>
        {placement.target && <Popover.Arrow className="nb-onboarding-beak" width={16} height={8} data-guide-beak=""/>}
      </Popover.Content>
    </Popover.Root>
    </>}
  </div>, document.body);
}
export default InteractivePracticePanel;
