export function NavBtn({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nb-settings-nav-button"
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ShortcutItem({ keyCombo, label }: { keyCombo: string; label: string }) {
  return (
    <div className="nb-settings-shortcut">
      <span style={{ color: 'var(--editor-text)' }}>{label}</span>
      <kbd>
        {keyCombo}
      </kbd>
    </div>
  );
}

export const formRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 'calc(var(--ui-font-size, 13px) * 12.5 / 13)',
  fontWeight: 500,
  color: 'var(--editor-text)',
};

export const inputStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  padding: '6px 10px',
  fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)',
  border: '1px solid var(--editor-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--editor-surface)',
  color: 'var(--editor-text)',
  width: '100%',
  boxSizing: 'border-box',
};
