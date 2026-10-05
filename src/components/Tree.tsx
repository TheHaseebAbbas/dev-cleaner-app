import type { ReactNode } from "react";
import { fmtAge, fmtBytes, type Part } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Checkbox, SizeBar } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

/** Column layout shared by every list in the app so rows line up. */
export const GRID = "grid grid-cols-[2rem_minmax(0,1fr)_6.5rem_8rem_4.5rem_6.5rem_9rem] items-center gap-x-3 px-3";

export interface RowModel {
  key: string;
  name: string;
  /** Muted second line, usually the folder path. */
  sub: string;
  typeLabel: string;
  bytes: number;
  files: number;
  modified: number;
  parts: Part[];
  status: ReactNode;
  protected?: boolean;
  /** Why the whole row cannot be ticked (view-only items, or items removable only in parts). */
  lockedReason?: string;
  viewOnly?: boolean;
  dim?: boolean;
}

export function ListHeader(props: { columns: { label: string; align?: "right"; sortKey?: string }[]; sortKey?: string; desc?: boolean; onSort?: (k: string) => void; allChecked?: boolean; someChecked?: boolean; onToggleAll?: () => void }) {
  return (
    <div className={`${GRID} sticky top-0 z-10 border-b bg-slate-100 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 divider dark:bg-slate-900`}>
      <span>{props.onToggleAll && <Checkbox checked={!!props.allChecked} indeterminate={props.someChecked} onChange={props.onToggleAll} label="Select all" />}</span>
      {props.columns.map((c) => (
        <button key={c.label} disabled={!c.sortKey} onClick={() => c.sortKey && props.onSort?.(c.sortKey)} className={`flex items-center gap-1 ${c.align === "right" ? "justify-end" : ""} ${c.sortKey ? "cursor-pointer hover:text-slate-800 dark:hover:text-slate-200" : "cursor-default"}`}>
          {c.label}
          {c.sortKey && props.sortKey === c.sortKey && <Icon name="chevron-down" className={`h-3 w-3 ${props.desc ? "" : "rotate-180"}`} />}
        </button>
      ))}
    </div>
  );
}

export function TreeRow(props: {
  model: RowModel;
  maxBytes: number;
  checked: boolean;
  partial: boolean;
  focused: boolean;
  expanded: boolean;
  selectedParts: Set<string>;
  onToggle: () => void;
  onExpand: () => void;
  onFocus: () => void;
  onTogglePart: (p: Part) => void;
  onSelectAllParts: (all: boolean) => void;
  /** Child rows can be selected only while the parent is not (a selected parent already covers them). */
  partsLocked?: boolean;
}) {
  const m = props.model;
  const hasParts = m.parts.length > 0;
  return (
    <div className="border-b divider">
      <div
        onClick={props.onFocus}
        className={`${GRID} cursor-pointer py-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${props.focused ? "bg-emerald-50 dark:bg-emerald-950/30" : ""} ${m.dim ? "opacity-60" : ""}`}
      >
        <Checkbox checked={props.checked} indeterminate={props.partial} disabled={m.protected || !!m.lockedReason} onChange={props.onToggle} label={`Select ${m.name}`} title={m.lockedReason ?? (m.protected ? "Protected paths cannot be removed" : undefined)} />
        <div className="flex min-w-0 items-start gap-1">
          {hasParts ? (
            <button className="mt-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" aria-expanded={props.expanded} aria-label={props.expanded ? "Hide parts" : "Show parts"} onClick={(e) => { e.stopPropagation(); props.onExpand(); }}>
              <Icon name={props.expanded ? "chevron-down" : "chevron-right"} className="h-4 w-4" />
            </button>
          ) : <span className="w-5 shrink-0" />}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{m.name}</span>
              {hasParts && <Badge icon="layers" title="Can be removed part by part">{m.parts.length} parts</Badge>}
            </div>
            <div className="muted truncate text-xs" title={m.sub}>{m.sub}</div>
          </div>
        </div>
        <div className="truncate text-slate-600 dark:text-slate-300">{m.typeLabel}</div>
        <div>
          <div className="text-right font-medium tabular-nums">{fmtBytes(m.bytes)}</div>
          <SizeBar fraction={props.maxBytes ? m.bytes / props.maxBytes : 0} />
        </div>
        <div className="muted text-right tabular-nums">{m.files.toLocaleString()}</div>
        <div className="muted whitespace-nowrap text-right" title={m.modified ? new Date(m.modified * 1000).toLocaleString() : ""}>{fmtAge(m.modified)}</div>
        <div className="min-w-0">{m.status}</div>
      </div>

      {hasParts && props.expanded && (
        <div className="border-t bg-slate-50 divider dark:bg-slate-900/50">
          <div className="muted flex items-center justify-between py-1.5 pl-[4.5rem] pr-3 text-xs">
            <span>{props.partsLocked ? "The whole folder is selected, so all parts will be removed." : "Parts of this folder. Tick only the ones you want to remove."}</span>
            {!props.partsLocked && (
              <span className="flex gap-3">
                <button className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => props.onSelectAllParts(true)}>Select all</button>
                <button className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => props.onSelectAllParts(false)}>Clear</button>
              </span>
            )}
          </div>
          {m.parts.map((p, idx) => {
            const last = idx === m.parts.length - 1;
            const checked = props.partsLocked || props.selectedParts.has(p.path);
            return (
              <div key={p.path} className={`${GRID} relative py-2 hover:bg-slate-100 dark:hover:bg-slate-900`}>
                <span />
                <div className="relative flex min-w-0 items-center gap-2 pl-8">
                  <span aria-hidden className="absolute left-[0.65rem] top-0 h-1/2 w-3.5 rounded-bl-lg border-b border-l border-slate-300 dark:border-slate-700" />
                  {!last && <span aria-hidden className="absolute left-[0.65rem] top-1/2 h-1/2 border-l border-slate-300 dark:border-slate-700" />}
                  <Checkbox checked={checked} disabled={props.partsLocked || m.protected || m.viewOnly} onChange={() => props.onTogglePart(p)} label={`Select ${p.name}`} />
                  <Icon name="folder" className="h-4 w-4 text-slate-400" />
                  <span className="truncate font-mono text-[13px]" title={p.path}>{p.name}</span>
                </div>
                <span />
                <div>
                  <div className="text-right tabular-nums">{fmtBytes(p.disk_bytes)}</div>
                  <SizeBar fraction={m.bytes ? p.disk_bytes / m.bytes : 0} tone="slate" />
                </div>
                <div className="muted text-right text-xs tabular-nums">{p.file_count.toLocaleString()}</div>
                <div className="muted whitespace-nowrap text-right text-xs">{fmtAge(p.last_modified)}</div>
                <div>{p.warning && <WarnBadge warnings={[p.warning]} />}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A collapsible group header row (project or category). */
export function GroupHeader(props: { icon: "folder" | "box"; title: string; sub?: string; count: number; bytes: number; open: boolean; onToggleOpen: () => void; checked?: boolean; partial?: boolean; onToggle?: () => void; countLabel: string }) {
  return (
    <div className={`${GRID} cursor-pointer border-b bg-slate-100/80 py-2 divider dark:bg-slate-900/80`} onClick={props.onToggleOpen}>
      <span>{props.onToggle && <Checkbox checked={!!props.checked} indeterminate={props.partial} onChange={props.onToggle} label={`Select all in ${props.title}`} />}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={props.open ? "chevron-down" : "chevron-right"} className="h-4 w-4 text-slate-500" />
        <Icon name={props.icon} className="h-4 w-4 text-emerald-600" />
        <span className="truncate font-semibold">{props.title}</span>
        {props.sub && <span className="muted truncate text-xs" title={props.sub}>{props.sub}</span>}
      </div>
      <span className="muted col-span-1 text-xs">{props.count} {props.countLabel}</span>
      <span className="text-right font-semibold tabular-nums">{fmtBytes(props.bytes)}</span>
      <span /><span /><span />
    </div>
  );
}
