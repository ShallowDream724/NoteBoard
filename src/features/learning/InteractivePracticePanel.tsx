import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { usePracticeStore } from './practiceStore';
import { GUIDE_STEPS } from './practiceCourse';
import { guideCalloutCount, guideTaskSatisfied, ownsPracticeEditor } from './practiceDetection';
import { clipGuideRect, guideAnchor, guideControlAnchor, unionRects, type GuideRect, type GuideSide } from './guideGeometry';
import { guideUICompleted, resolveGuideTarget, visibleGuideElement, type GuideTarget } from './guideTargets';
import { useWindowStore } from '../../stores/windowStore';
import { dismissTransientAnnotations } from '../editor-md/annotations/commands';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import './interactivePractice.css';

export interface InteractivePracticePanelProps { activeEditor: Editor | null; activeKey: string | null }
interface Placement { stepId: string; generation: number; rects: GuideRect[]; target: GuideRect | null; side: GuideSide; align?: 'start' | 'end'; fallback?: GuideTarget['fallback']; blocked: boolean }
const emptyPlacement: Placement = { stepId: '', generation: -1, rects: [], target: null, side: 'top', blocked: true };
const confirmOutcome = new Set(['selection', 'highlight', 'annotation-open', 'annotation-save', 'insert-callout']);

/** One scoped observer for one active sample. All overlay pixels ignore pointer input. */
export function InteractivePracticePanel({ activeEditor, activeKey }: InteractivePracticePanelProps) {
  const session = usePracticeStore();
  const card = useRef<HTMLDivElement>(null);
  const scheduleMeasurement = useRef<() => void>(() => {});
  const attachCard = useCallback((node: HTMLDivElement | null) => { card.current = node; if (node) scheduleMeasurement.current(); }, []);
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
    let observedTarget: HTMLElement | null = null, observedCard: HTMLElement | null = null, taskComplete = false;
    let checkedDocument: typeof editor.state.doc | null = null, checkedSelection: typeof editor.state.selection | null = null;
    const current = () => alive && !editor.isDestroyed && usePracticeStore.getState().generation === generation && usePracticeStore.getState().sessionKey === key && usePracticeStore.getState().stepId === stepId && useWindowStore.getState().activeKey === key;
    const measure = () => {
      frame = 0; if (!current()) return;
      const modal = visibleGuideElement('[aria-modal="true"]');
      if (!modal) {
        const changed = checkedDocument !== editor.state.doc || stepId === 'selection' && checkedSelection !== editor.state.selection;
        checkedDocument = editor.state.doc; checkedSelection = editor.state.selection;
        if (changed) taskComplete = guideTaskSatisfied(stepId, editor.state, baseline.current!.callouts);
        const satisfied = guideUICompleted(editor, stepId) || taskComplete;
        if (usePracticeStore.getState().completed.includes(stepId)) {
          if (confirmOutcome.has(stepId) && !satisfied) usePracticeStore.getState().reopen(key, stepId);
          else return;
        } else if (satisfied) {
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
        const observedSurface = observedTarget?.closest<HTMLElement>('.nb-editor-selection-toolbar,.responsive-toolbar,.nb-annotation-panel') ?? observedTarget;
        targetMutations.disconnect();
        if (observedSurface) targetMutations.observe(observedSurface, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'inert'] });
      }
      if (card.current !== observedCard) {
        if (observedCard) resize.unobserve(observedCard);
        observedCard = card.current;
        if (observedCard) resize.observe(observedCard);
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const screen = { left: 4, top: 4, width: viewport.width - 8, height: viewport.height - 8 };
      const contentTarget = !!target.element && editor.view.dom.contains(target.element), owner = findScrollContainer(editor.view.dom).getBoundingClientRect();
      const contentBounds = owner.width > 0 && owner.height > 0 ? clipGuideRect({ left: owner.left, top: owner.top, width: owner.width, height: owner.height }, screen) ?? screen : screen;
      const bounds = contentTarget ? contentBounds : screen;
      if (!modal && initialScroll && contentTarget && target.element && box) {
        initialScroll = false;
        if (box.top < bounds.top + 12 || box.top + box.height > bounds.top + bounds.height - 12) {
          target.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
          schedule(); return;
        }
      }
      const rects = target.rects.map(r => clipGuideRect(r, bounds)).filter((r): r is GuideRect => !!r);
      const contextRects = target.contextRects?.map(r => clipGuideRect(r, contentBounds)).filter((r): r is GuideRect => !!r);
      const anchor = contextRects?.length ? guideControlAnchor(rects, contextRects, screen, { width: card.current?.offsetWidth || 280, height: card.current?.offsetHeight || 160 })
        : guideAnchor(rects, screen, card.current?.offsetHeight || 160);
      const nextPlacement: Placement = { stepId, generation, rects, target: anchor.rect, side: anchor.side, align: 'align' in anchor ? anchor.align : undefined, fallback: target.fallback, blocked: !!modal };
      const signature = JSON.stringify(nextPlacement);
      if (signature !== lastGeometry) { lastGeometry = signature; setPlacement(nextPlacement); }
    };
    const schedule = () => { if (current() && !frame) frame = requestAnimationFrame(measure); };
    scheduleMeasurement.current = schedule;
    const targetMutations = new MutationObserver(schedule);
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
    return () => { alive = false; scheduleMeasurement.current = () => {}; cancelAnimationFrame(frame); mutations.disconnect(); targetMutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); window.removeEventListener('keydown', escape); editor.off('transaction', schedule); editor.off('destroy', schedule); };
  }, [activeEditor, activeKey, active, session.sessionKey, session.generation, session.stepId]);
  useEffect(() => {
    if (!active || !completed || !step) return;
    const generation = session.generation, key = session.sessionKey;
    const timer = setTimeout(() => {
      const current = usePracticeStore.getState();
      if (current.generation !== generation || current.sessionKey !== key || current.stepId !== step.id || useWindowStore.getState().activeKey !== key || !ownsPracticeEditor(activeEditor, key)) return;
      if (confirmOutcome.has(step.id) && !guideTaskSatisfied(step.id, activeEditor.state, baseline.current!.callouts) && !guideUICompleted(activeEditor, step.id)) {
        current.reopen(key!, step.id); return;
      }
      if (step.id === 'annotation-save') dismissTransientAnnotations(activeEditor);
      const nextStep = GUIDE_STEPS[index + 1];
      if (nextStep) current.selectStep(nextStep.id); else current.exit();
    }, step.settleMs ?? 350);
    return () => clearTimeout(timer);
  }, [active, activeEditor, completed, step, index, session.generation, session.sessionKey]);

  if (!active || !step) return null;
  const locate = () => { if (activeEditor) resolveGuideTarget(activeEditor, session.stepId).element?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); };
  const instruction = placement.fallback === 'selection' ? `可以拖选完整的“把想法写下来”，${session.stepId === 'highlight' ? '再点彩色 A 试试高亮。' : '再用问号按钮附上一条说明。'}`
    : placement.fallback === 'annotation-target' ? '这次选区没有包含完整的“把想法写下来”。取消草稿后，可以重新拖选这一小段。'
    : placement.fallback === 'missing-text' ? '这段示例文字已经改动。可以跳过这一项，继续看看其他功能。'
    : placement.fallback === 'annotation' ? '说明编辑区已经收起。这个问号按钮可以再次打开它。'
    : placement.fallback === 'command' ? '在这行输入 /note，可以再次找到 Note 提示块。' : step.instruction;
  const visible = !completed && !placement.blocked && placement.stepId === session.stepId && placement.generation === session.generation;
  return createPortal(<div className="nb-onboarding-layer" data-guide-step={session.stepId} data-guide-completed={completed || undefined}>
    {visible && <>
    <svg className="nb-onboarding-map" aria-hidden="true" focusable="false">
      {placement.rects.map((r, index) => <rect key={index} data-guide-spotlight="" x={r.left - 4} y={r.top - 4} width={r.width + 8} height={r.height + 8} rx="5" className="nb-onboarding-ring"/>)}
    </svg>
    <Popover.Root open modal={false}>
      <Popover.Anchor virtualRef={anchor}/>
      <Popover.Content ref={attachCard} className="nb-onboarding-card" role="region" aria-label="上手引导" side={placement.side} align={placement.align ?? 'center'} sideOffset={10} collisionPadding={12} arrowPadding={16}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={session.exit}>
        <header><span>{index + 1} / {GUIDE_STEPS.length}</span><button type="button" aria-label="退出引导" onClick={session.exit}><X size={16}/></button></header>
        <div className="nb-onboarding-copy" aria-live="polite"><h2>{step.title}</h2><p>{instruction}</p></div>
        {!placement.target && placement.fallback !== 'missing-text' && <button type="button" className="nb-onboarding-locate" onClick={locate}>定位到这一步</button>}
        <footer><button type="button" className="nb-onboarding-skip" onClick={() => { session.skip(session.stepId); next(); }}>跳过这步</button></footer>
        {placement.target && <Popover.Arrow className="nb-onboarding-beak" width={16} height={8} data-guide-beak=""/>}
      </Popover.Content>
    </Popover.Root>
    </>}
  </div>, document.body);
}
export default InteractivePracticePanel;
