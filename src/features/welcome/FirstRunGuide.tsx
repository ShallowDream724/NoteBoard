import { useState } from 'react';
import { GripVertical, PanelLeft, Pin } from 'lucide-react';
import './firstRunGuide.css';

const STEPS = [
  { icon: PanelLeft, title: '给正文多一点空间', text: '左上角的侧栏按钮可以收起文件列表；再点一次就能展开。' },
  { icon: GripVertical, title: '拖动内容，重新组织想法', text: '把鼠标停在段落左边缘，拖动出现的六点把手，就能移动整块内容。点击把手也能打开块菜单。' },
  { icon: Pin, title: '把说明留在手边', text: '点开“带说明的文字”或代码块的说明图标，用图钉固定浮窗，再拖动浮窗顶部换个位置。' },
] as const;

/** A small, non-modal companion to the first showcase tab; never takes focus. */
export function FirstRunGuide({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  if (!active) return null;
  const { icon: Icon, title, text } = STEPS[step];

  return (
    <aside className="first-run-guide" data-step={step} aria-label="快速上手" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); }
    }}>
      <div className="first-run-guide-heading">
        <Icon size={17} aria-hidden="true" />
        <span>快速上手 · {step + 1} / {STEPS.length}</span>
        <button type="button" className="first-run-guide-skip" onClick={onDismiss}>跳过</button>
      </div>
      <div aria-live="polite">
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <div className="first-run-guide-actions">
        {step > 0 && <button type="button" onClick={() => setStep(step - 1)}>上一步</button>}
        <button type="button" className="first-run-guide-next" onClick={() => {
          if (step === STEPS.length - 1) onDismiss();
          else setStep(step + 1);
        }}>{step === STEPS.length - 1 ? '开始体验' : '下一步'}</button>
      </div>
    </aside>
  );
}
