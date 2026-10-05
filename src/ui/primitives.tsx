import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
};

export function Badge({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONES[tone]}`}>
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
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[1.1rem]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === o.value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}>
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
        <div className="absolute top-0 h-full w-1/3 rounded-full bg-emerald-500" style={{ animation: "slide-indeterminate 1.1s ease-in-out infinite" }} />
      ) : (
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%` }} />
      )}
    </div>
  );
}

/** Thin bar showing how big something is compared to its siblings. */
export function SizeBar({ fraction, tone = "green" }: { fraction: number; tone?: "green" | "slate" }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className={`h-full rounded-full ${tone === "green" ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-500"}`} style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%` }} />
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "green" }) {
  return (
    <div className="card px-4 py-3">
      <div className="muted text-xs">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === "green" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</div>
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
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${c}`} role="status">
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div role="dialog" aria-modal="true" aria-label={props.title} className={`card rise flex max-h-[90vh] w-full flex-col shadow-2xl ${props.width ?? "max-w-lg"}`}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4 divider">
          <div>
            <h2 className="text-base font-semibold">{props.title}</h2>
            {props.subtitle && <p className="muted text-xs">{props.subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">{props.children}</div>
        {props.footer && <div className="flex justify-end gap-2 border-t px-5 py-3 divider">{props.footer}</div>}
      </div>
    </div>
  );
}
