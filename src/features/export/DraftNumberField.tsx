import { useEffect, useState } from 'react';

/** Keep an in-progress number separate from the last printable setting. */
export function DraftNumberField({ label, value, min, max, step, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <label className="export-field">{label}
    <input type="number" min={min} max={max} step={step} value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
  </label>;
}
