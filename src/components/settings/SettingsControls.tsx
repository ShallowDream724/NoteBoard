export function NavBtn({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--editor-selection)' : 'transparent',
        color: active ? 'var(--accent-strong)' : 'var(--editor-text)',
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--toolbar-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
        }
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ShortcutItem({ keyCombo, label }: { keyCombo: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'var(--editor-surface)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--editor-border)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--editor-text)' }}>{label}</span>
      <kbd
        style={{
          padding: '2px 6px',
          background: 'var(--editor-bg)',
          border: '1px solid var(--editor-border)',
          borderRadius: 3,
          fontFamily: 'var(--mono-font-family)',
          fontSize: 11,
          color: 'var(--editor-text-secondary)',
        }}
      >
        {keyCombo}
      </kbd>
    </div>
  );
}

export const formRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--editor-text)',
};

export const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  border: '1px solid var(--editor-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--editor-surface)',
  color: 'var(--editor-text)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
