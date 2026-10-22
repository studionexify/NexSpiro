import { useId, useState, type ReactNode, type KeyboardEvent, type CSSProperties } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'primary';

/* ---------- Switch */
export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string; // aria-label
  disabled?: boolean;
  title?: string;
  className?: string;
}
export function Switch({ checked, onChange, label, disabled, title, className }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={title ?? label}
      disabled={disabled} className={cx('nsk-switch', className)}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }} />
  );
}

/* ---------- Chip */
export interface ChipProps {
  children: ReactNode;
  on?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
}
export function Chip({ children, on, onClick, icon, title, disabled, className }: ChipProps) {
  return (
    <button type="button" className={cx('nsk-chip', on && 'on', className)} aria-pressed={on}
      onClick={onClick} title={title} disabled={disabled}>
      {icon}{children}
    </button>
  );
}

/* ---------- Card */
export interface CardProps {
  children?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  flat?: boolean;
  className?: string;
  style?: CSSProperties;
}
export function Card({ children, title, actions, flat, className, style }: CardProps) {
  return (
    <section className={cx('nsk-card', flat && 'flat', className)} style={style}>
      {(title || actions) && (
        <div className="nsk-card-h"><span style={{ flex: 1 }}>{title}</span>{actions}</div>
      )}
      {children != null && <div className={title || actions ? 'nsk-card-b' : undefined}>{children}</div>}
    </section>
  );
}

/* ---------- Accordion (collapsible card; summary badge in header) */
export interface AccordionProps {
  title: ReactNode;
  children: ReactNode;
  /** Shown right-aligned in the header, e.g. <MetricBadge/> or "3 changed". */
  summary?: ReactNode;
  icon?: ReactNode;
  /** Extra header controls (e.g. a Switch); clicks don't toggle. */
  actions?: ReactNode;
  open?: boolean; // controlled
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  flat?: boolean;
  className?: string;
}
export function Accordion({ title, children, summary, icon, actions, open, defaultOpen = false, onOpenChange, flat, className }: AccordionProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const id = useId();
  const toggle = () => { const n = !isOpen; if (open === undefined) setInner(n); onOpenChange?.(n); };
  return (
    <section className={cx('nsk-card nsk-acc', isOpen && 'open', flat && 'flat', className)}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button type="button" className="nsk-acc-h" aria-expanded={isOpen} aria-controls={id} onClick={toggle}>
          <svg className="nsk-acc-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          {icon}
          <span className="nsk-acc-t">{title}</span>
          {summary}
        </button>
        {actions && <div style={{ paddingRight: 10, display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      {isOpen && <div id={id} className="nsk-acc-b">{children}</div>}
    </section>
  );
}

/* ---------- MetricBadge */
export interface MetricBadgeProps {
  value: ReactNode;
  label?: ReactNode;
  unit?: string;
  tone?: Tone;
  icon?: ReactNode;
  title?: string;
  className?: string;
}
export function MetricBadge({ value, label, unit, tone = 'neutral', icon, title, className }: MetricBadgeProps) {
  return (
    <span className={cx('nsk-badge', tone !== 'neutral' && tone, className)} title={title}>
      {icon}{label && <span>{label}</span>}<b>{value}{unit && <span>{unit}</span>}</b>
    </span>
  );
}

/* ---------- StatusDot */
export interface StatusDotProps {
  tone?: Tone;
  color?: string; // custom swatch colour (overrides tone)
  pulse?: boolean;
  label?: string; // accessible label; omit for decorative
  size?: number;
  className?: string;
}
export function StatusDot({ tone = 'neutral', color, pulse, label, size, className }: StatusDotProps) {
  return (
    <i className={cx('nsk-dot', tone !== 'neutral' && tone, pulse && 'pulse', className)}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} title={label}
      style={{ ...(color ? { background: color } : null), ...(size ? { width: size, height: size } : null) }} />
  );
}

/* ---------- PillGroup (segmented single-select) */
export interface PillOption<T extends string> { value: T; label: ReactNode; title?: string; disabled?: boolean; icon?: ReactNode }
export interface PillGroupProps<T extends string> {
  options: PillOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string; // aria-label for the group
  className?: string;
}
export function PillGroup<T extends string>({ options, value, onChange, size = 'md', label, className }: PillGroupProps<T>) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const en = options.filter((o) => !o.disabled);
    const i = en.findIndex((o) => o.value === value);
    const n = en[(i + (e.key === 'ArrowRight' ? 1 : -1) + en.length) % en.length];
    if (n) { e.preventDefault(); onChange(n.value); }
  };
  return (
    <div className={cx('nsk-pill', size === 'sm' && 'sm', className)} role="group" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title}
          disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Kbd */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('nsk-kbd', className)}>{children}</kbd>;
}

/* ---------- IconButton (tooltip + optional shortcut) */
export interface IconButtonProps {
  icon: ReactNode;
  label: string; // tooltip + aria-label
  onClick?: () => void;
  kbd?: string;
  active?: boolean; // sets aria-pressed when defined
  disabled?: boolean;
  tip?: 'right' | 'left' | 'top' | 'bottom' | 'none';
  size?: 'sm' | 'md';
  children?: ReactNode; // optional trailing text
  className?: string;
}
export function IconButton({ icon, label, onClick, kbd, active, disabled, tip = 'bottom', size = 'md', children, className }: IconButtonProps) {
  return (
    <button type="button" className={cx('nsk-ib', size === 'sm' && 'sm', className)} aria-label={label}
      aria-pressed={active} aria-keyshortcuts={kbd} disabled={disabled} onClick={onClick}>
      {icon}{children}
      {tip !== 'none' && <span className={cx('nsk-tip', tip)} role="tooltip">{label}{kbd && <Kbd>{kbd}</Kbd>}</span>}
    </button>
  );
}

/* ---------- NumField */
export interface NumFieldProps {
  value: number | string;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  modified?: boolean;
  disabled?: boolean;
  label?: string; // aria-label
  pinned?: boolean; // when defined, renders the pin star
  onTogglePin?: () => void;
  width?: number | string;
  className?: string;
}
export function NumField({ value, onChange, unit, min, max, step, modified, disabled, label, pinned, onTogglePin, width, className }: NumFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  const bump = (dir: 1 | -1, mul: number) => {
    const cur = parseFloat(String(draft ?? value)) || 0;
    const s = (step ?? 1) * mul;
    const n = Math.round((cur + dir * s) * 1e6) / 1e6;
    setDraft(null);
    onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  return (
    <span className={cx('nsk-num-w', className)} style={width != null ? { width } : undefined}>
      <span className={cx('nsk-num', modified && 'mod', disabled && 'dis')} title={modified ? 'Changed from preset' : undefined}>
        <input inputMode="decimal" aria-label={label} disabled={disabled} value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1); }
            e.stopPropagation(); // keep global shortcuts from firing while typing
          }} />
        {unit && <span>{unit}</span>}
      </span>
      {pinned !== undefined && (
        <button type="button" className="nsk-pin" aria-pressed={pinned} aria-label={pinned ? 'Unpin' : 'Pin to top'}
          title={pinned ? 'Unpin' : 'Pin to top'} onClick={onTogglePin}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
        </button>
      )}
    </span>
  );
}
