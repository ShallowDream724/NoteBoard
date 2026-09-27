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

export function SettingsPanelHeading({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className="nb-settings-panel-heading"><div><h3>{title}</h3><p>{description}</p></div>{actions}</header>;
}

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="nb-settings-section"><header><h4>{title}</h4>{description && <p>{description}</p>}</header><div className="nb-settings-section-body">{children}</div></section>;
}

export function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <label className="nb-settings-row nb-settings-control-row"><span><span className="nb-settings-label">{label}</span>{description && <span className="nb-settings-hint">{description}</span>}</span>{children}</label>;
}

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
