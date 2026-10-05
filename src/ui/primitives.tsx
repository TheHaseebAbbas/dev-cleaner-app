import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  brand: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
};

export function Badge({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${TONES[tone]}`}>
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** Checkbox with an optional "some selected" state. */
export function Checkbox(props: { checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void; label?: string; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!props.indeterminate && !props.checked; }, [props.indeterminate, props.checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={props.label}
      title={props.title}
      className="cb"
      checked={props.checked}
      disabled={props.disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={props.onChange}
    />
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="muted block text-xs">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[1.1rem]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === o.value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}>
          {o.icon && <Icon name={o.icon} className="h-3.5 w-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, indeterminate }: { value?: number; indeterminate?: boolean }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}>
      {indeterminate ? (
        <div className="absolute top-0 h-full w-1/3 rounded-full bg-indigo-500" style={{ animation: "slide-indeterminate 1.1s ease-in-out infinite" }} />
      ) : (
        <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%` }} />
      )}
    </div>
  );
}

/** Thin bar showing how big something is compared to its siblings. */
export function SizeBar({ fraction, tone = "green" }: { fraction: number; tone?: "green" | "slate" }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className={`h-full rounded-full ${tone === "green" ? "bg-indigo-500/70 dark:bg-indigo-400/70" : "bg-slate-400 dark:bg-slate-500"}`} style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%` }} />
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "green" }) {
  return (
    <div className="card px-4 py-3">
      <div className="muted text-xs">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === "green" ? "text-indigo-600 dark:text-indigo-400" : ""}`}>{value}</div>
      {hint && <div className="muted text-xs">{hint}</div>}
    </div>
  );
}

export function EmptyState(props: { icon: IconName; title: string; description?: ReactNode; actions?: ReactNode; tone?: "neutral" | "success" }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-14 text-center">
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${props.tone === "success" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
        <Icon name={props.icon} className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.description && <div className="muted mt-1 text-sm">{props.description}</div>}
      {props.actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{props.actions}</div>}
    </div>
  );
}

export function Banner({ tone, icon, title, children, actions }: { tone: "amber" | "red" | "blue" | "green"; icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  const c = {
    amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    red: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
    blue: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 ${c}`} role="status">
      <Icon name={icon} className="mt-0.5 h-5 w-5" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded bg-slate-200 dark:bg-slate-800" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
            <div className="h-2.5 w-2/3 rounded bg-slate-100 dark:bg-slate-800/60" />
          </div>
          <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

export function Modal(props: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("button:not([aria-label='Close']):not([disabled]), input, [tabindex]") ?? box.current;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, []);
  return (
    <div className="fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} className={`float rise flex max-h-[90vh] w-full flex-col ${props.width ?? "max-w-lg"}`}>
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-base font-semibold">{props.title}</h2>
            {props.subtitle && <p className="muted text-[13px]">{props.subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 text-sm">{props.children}</div>
        {props.footer && <div className="flex justify-end gap-2 border-t px-5 py-3 divider">{props.footer}</div>}
      </div>
    </div>
  );
}

/** Small floating panel opened from a trigger button. Closes on outside click and Escape. */
export function Popover(props: { label: string; icon?: IconName; badge?: number; align?: "left" | "right"; width?: string; triggerClass?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button className={props.triggerClass ?? "btn"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {props.icon && <Icon name={props.icon} className="h-4 w-4" />}{props.label}
        {!!props.badge && <span className="ml-0.5 rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold leading-4 text-white dark:bg-indigo-500">{props.badge}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={props.label} className={`float rise absolute z-30 mt-1.5 p-4 ${props.align === "right" ? "right-0" : "left-0"} ${props.width ?? "w-72"}`}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Title, one-line explanation, and the page's main actions. */
export function PageHeader(props: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight">{props.title}</h1>
        <p className="muted text-[13px]">{props.subtitle}</p>
      </div>
      {props.actions && <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
    </div>
  );
}

/** The few numbers that matter, in one quiet strip instead of a row of cards. */
export function MetricStrip(props: { items: { label: string; value: ReactNode; hero?: boolean; hint?: string }[]; note?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-2">
      {props.items.map((m) => (
        <div key={m.label}>
          <div className={`tabular-nums leading-none ${m.hero ? "text-[26px] font-semibold tracking-tight" : "text-[20px] font-semibold text-slate-700 dark:text-slate-200"}`}>{m.value}</div>
          <div className="muted mt-1 text-xs">{m.label}{m.hint ? ` · ${m.hint}` : ""}</div>
        </div>
      ))}
      {props.note && <div className="muted ml-auto self-center text-xs">{props.note}</div>}
    </div>
  );
}

export function Toast({ tone, children, onClose }: { tone: "info" | "error"; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const t = window.setTimeout(onClose, tone === "error" ? 8000 : 4500); return () => window.clearTimeout(t); }, [onClose, tone]);
  return (
    <div role="status" className={`float rise fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 px-4 py-3 text-sm ${tone === "error" ? "!border-red-300 dark:!border-red-800" : ""}`}>
      <Icon name={tone === "error" ? "x-circle" : "info"} className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "error" ? "text-red-600 dark:text-red-400" : "text-sky-600 dark:text-sky-400"}`} />
      <div className="min-w-0 flex-1">{children}</div>
      <button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={onClose}><Icon name="x" /></button>
    </div>
  );
}

/** A compact dropdown that picks one value ("By project ▾"). */
export function MenuSelect<T extends string>(props: { value: T; options: { value: T; label: string; icon?: IconName; hint?: string }[]; onChange: (v: T) => void; label: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open]);
  const cur = props.options.find((o) => o.value === props.value);
  return (
    <div ref={root} className="relative">
      <button className="btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${props.label}: ${cur?.label}`} onClick={() => setOpen((o) => !o)}>
        {cur?.icon && <Icon name={cur.icon} className="h-4 w-4" />}{cur?.label}<Icon name="chevron-down" className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {open && (
        <ul role="listbox" aria-label={props.label} className={`float rise absolute z-30 mt-1.5 w-56 p-1 ${props.align === "left" ? "left-0" : "right-0"}`}>
          {props.options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === props.value}>
              <button autoFocus={o.value === props.value} className={`flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-700/60 dark:focus-visible:bg-slate-700/60 ${o.value === props.value ? "font-semibold text-indigo-700 dark:text-indigo-300" : ""}`} onClick={() => { props.onChange(o.value); setOpen(false); }}>
                {o.icon && <Icon name={o.icon} className="mt-0.5 h-4 w-4" />}
                <span className="flex-1">{o.label}{o.hint && <span className="muted block text-xs font-normal">{o.hint}</span>}</span>
                {o.value === props.value && <Icon name="check" className="mt-0.5 h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A quiet collapsible section ("Advanced details ▸"). */
export function Disclosure(props: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; onOpen?: () => void; className?: string }) {
  return (
    <details className={`group ${props.className ?? ""}`} open={props.defaultOpen} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) props.onOpen?.(); }}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[13px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />{props.title}
      </summary>
      <div className="pt-2">{props.children}</div>
    </details>
  );
}
