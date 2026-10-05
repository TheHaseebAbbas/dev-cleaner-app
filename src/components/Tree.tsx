import type { ReactNode } from "react";
import { fmtAge, fmtBytes, type Part } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Checkbox, SizeBar } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

/** Tree geometry in px: left padding, indent per level, chevron slot, gap, checkbox. */
const PAD = 12;
const STEP = 40;
const CHEV = 20;
const GAP = 8;
const BOX = 16;
const guideX = (level: number) => PAD + level * STEP + CHEV + GAP + BOX / 2;
const indent = (depth: number) => ({ paddingLeft: PAD + depth * STEP });

/** Vertical lines drawn behind a row, one per ancestor level, so the hierarchy reads at a glance. */
function Guides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, l) => (
        <span key={l} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-slate-200 dark:bg-slate-700" style={{ left: guideX(l) }} />
      ))}
    </>
  );
}

export interface RowModel {
  key: string;
  name: string;
  /** One plain sentence about what it is. */
  desc: string;
  /** Muted extra detail such as the ecosystem and file count. */
  meta?: string;
  bytes: number;
  parts: Part[];
  /** Badges shown beside the name (warnings, protected, view only). */
  badges?: ReactNode;
  protected?: boolean;
  /** Why the whole row cannot be ticked (view-only items, or items removable only in parts). */
  lockedReason?: string;
  viewOnly?: boolean;
  /** Cells for the compact Flat table (type and project). */
  flat?: { type: string; project: string };
}

export function TreeRow(props: {
  model: RowModel;
  maxBytes: number;
  checked: boolean;
  partial: boolean;
  focused: boolean;
  expanded: boolean;
  selectedParts: Set<string>;
  /** 0 when the list is flat, 1 when rows sit under a group header. Parts are always one level deeper. */
  depth?: number;
  onToggle: () => void;
  onExpand: () => void;
  onFocus: () => void;
  onTogglePart: (p: Part) => void;
  onSelectAllParts: (all: boolean) => void;
  /** Child rows can be selected only while the parent is not (a selected parent already covers them). */
  partsLocked?: boolean;
}) {
  const m = props.model;
  const depth = props.depth ?? 0;
  const hasParts = m.parts.length > 0;
  const locked = m.protected || !!m.lockedReason;
  return (
    <div className="border-b divider">
      <div
        onClick={props.onFocus}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") { e.preventDefault(); props.onFocus(); }
          if (e.key === " " && !locked) { e.preventDefault(); props.onToggle(); }
          if (e.key === "ArrowRight" && hasParts && !props.expanded) props.onExpand();
          if (e.key === "ArrowLeft" && hasParts && props.expanded) props.onExpand();
        }}
        tabIndex={0}
        data-row
        aria-label={`${m.name}, ${fmtBytes(m.bytes)}`}
        className={`relative flex cursor-pointer items-center gap-3 py-2.5 pr-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${props.focused ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
        style={indent(depth)}
      >
        <Guides depth={depth} />
        <div className="relative flex min-w-0 flex-1 items-center" style={{ gap: GAP }}>
          <span className="flex shrink-0 justify-center" style={{ width: CHEV }}>
            {hasParts && (
              <button tabIndex={-1} className="rounded p-0.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700" aria-expanded={props.expanded} aria-label={props.expanded ? "Hide parts" : "Show parts"} onClick={(e) => { e.stopPropagation(); props.onExpand(); }}>
                <Icon name={props.expanded ? "chevron-down" : "chevron-right"} className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          <Checkbox checked={props.checked} indeterminate={props.partial} disabled={locked} onChange={props.onToggle} label={`Select ${m.name}`} title={m.lockedReason ?? (m.protected ? "Protected paths cannot be removed" : undefined)} />
          <Icon name="folder" className="h-[18px] w-[18px] shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`truncate font-medium ${m.viewOnly ? "text-slate-600 dark:text-slate-300" : ""}`}>{m.name}</span>
              {hasParts && <Badge icon="layers" title="Can be removed part by part">{m.parts.length} parts</Badge>}
              {m.badges}
            </div>
            <div className="muted truncate text-[13px]" title={m.desc}>{m.desc}{m.meta ? <span className="faint"> · {m.meta}</span> : null}</div>
          </div>
        </div>
        {m.flat && (
          <>
            <div className="muted hidden w-28 shrink-0 truncate text-[13px] min-[1000px]:block">{m.flat.type}</div>
            <div className="muted hidden w-36 shrink-0 truncate text-[13px] min-[1100px]:block" title={m.flat.project}>{m.flat.project}</div>
          </>
        )}
        <div className="w-28 shrink-0">
          <div className="text-right font-medium tabular-nums">{fmtBytes(m.bytes)}</div>
          <SizeBar fraction={props.maxBytes ? m.bytes / props.maxBytes : 0} />
        </div>
      </div>

      {hasParts && props.expanded && (
        <div className="fade border-t divider">
          <div className="relative flex items-center justify-between gap-3 bg-slate-50 py-1.5 pr-4 text-xs dark:bg-slate-800/40" style={indent(depth + 1)}>
            <Guides depth={depth + 1} />
            <span className="muted" style={{ paddingLeft: CHEV + GAP }}>{props.partsLocked ? "The whole folder is selected, so all parts will be removed." : m.viewOnly ? "Parts of this location (view only)." : m.lockedReason ? "This location can only be cleaned one part at a time." : "Select individual parts"}</span>
            {!props.partsLocked && !m.viewOnly && !m.protected && (
              <span className="flex shrink-0 gap-3">
                <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => props.onSelectAllParts(true)}>Select all</button>
                <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => props.onSelectAllParts(false)}>Clear</button>
              </span>
            )}
          </div>
          {m.parts.map((p) => {
            const checked = props.partsLocked || props.selectedParts.has(p.path);
            return (
              <div key={p.path} className={`relative flex items-center gap-3 border-t py-2 pr-4 divider hover:bg-slate-50 dark:hover:bg-slate-800/50 ${checked ? "bg-indigo-50/60 dark:bg-indigo-500/10" : ""}`} style={indent(depth + 1)}>
                <Guides depth={depth + 1} />
                <div className="relative flex min-w-0 flex-1 items-center" style={{ gap: GAP }}>
                  <span className="shrink-0" style={{ width: CHEV }} />
                  <Checkbox checked={checked} disabled={props.partsLocked || m.protected || m.viewOnly} onChange={() => props.onTogglePart(p)} label={`Select ${p.name}`} />
                  <span className="truncate font-mono text-[13px]" title={p.path}>{p.name}</span>
                  {p.warning && <WarnBadge warnings={[p.warning]} />}
                  <span className="faint shrink-0 text-xs">{p.file_count.toLocaleString()} files · {fmtAge(p.last_modified)}</span>
                </div>
                <div className="w-28 shrink-0">
                  <div className="text-right tabular-nums">{fmtBytes(p.disk_bytes)}</div>
                  <SizeBar fraction={m.bytes ? p.disk_bytes / m.bytes : 0} tone="slate" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A collapsible group header (a project or a category). Always the top level of the tree. */
export function GroupHeader(props: { icon: "folder" | "box"; title: string; path?: string; detail?: string; bytes: number; open: boolean; onToggleOpen: () => void; checked?: boolean; partial?: boolean; onToggle?: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={props.open}
      onClick={props.onToggleOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); props.onToggleOpen(); } }}
      className="flex cursor-pointer items-center gap-3 border-b bg-slate-100 py-2.5 pr-4 outline-none divider hover:bg-slate-200/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-slate-800/70 dark:hover:bg-slate-800"
      style={{ paddingLeft: PAD }}
    >
      <div className="flex min-w-0 flex-1 items-center" style={{ gap: GAP }}>
        <span className="flex shrink-0 justify-center text-slate-500" style={{ width: CHEV }}><Icon name={props.open ? "chevron-down" : "chevron-right"} className="h-4 w-4" /></span>
        {props.onToggle ? <Checkbox checked={!!props.checked} indeterminate={props.partial} onChange={props.onToggle} label={`Select all in ${props.title}`} /> : <span style={{ width: BOX }} />}
        <Icon name={props.icon} className="h-[18px] w-[18px] shrink-0 text-indigo-600 dark:text-indigo-300" />
        <div className="min-w-0">
          <div className="truncate font-semibold">{props.title}</div>
          {(props.path || props.detail) && (
            <div className="muted truncate text-xs">
              {props.path && <span className="font-mono" title={props.path}>{props.path}</span>}
              {props.path && props.detail ? " · " : ""}{props.detail}
            </div>
          )}
        </div>
      </div>
      <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{fmtBytes(props.bytes)}</span>
    </div>
  );
}

/** One button that expands every group and part, or collapses them all again. */
export function ExpandToggle(props: { allOpen: boolean; onChange: (open: boolean) => void }) {
  const label = props.allOpen ? "Collapse all" : "Expand all";
  return (
    <button className="btn" onClick={() => props.onChange(!props.allOpen)} title={props.allOpen ? "Close every group and part" : "Open every group and show all parts"}>
      <Icon name={props.allOpen ? "chevrons-up" : "chevrons-down"} className="h-4 w-4" />{label}
    </button>
  );
}

/** Column titles for the Flat view; widths match the row cells. */
export function FlatHeader(props: { sortKey: string; desc: boolean; onSort: (k: string) => void; allChecked: boolean; someChecked: boolean; onToggleAll: () => void }) {
  const col = (label: string, key: string, cls: string) => (
    <button className={`flex items-center gap-1 ${cls} hover:text-slate-900 dark:hover:text-white`} onClick={() => props.onSort(key)}>
      {label}{props.sortKey === key && <Icon name="chevron-down" className={`h-3 w-3 ${props.desc ? "" : "rotate-180"}`} />}
    </button>
  );
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-slate-100 py-2 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500 divider dark:bg-slate-800" style={{ paddingLeft: PAD + CHEV + GAP }}>
      <div className="flex min-w-0 flex-1 items-center" style={{ gap: GAP }}>
        <Checkbox checked={props.allChecked} indeterminate={props.someChecked} onChange={props.onToggleAll} label="Select all" />
        {col("Folder", "name", "")}
      </div>
      <div className="hidden w-28 shrink-0 min-[1000px]:block">Type</div>
      <div className="hidden w-36 shrink-0 min-[1100px]:block">{col("Project", "project", "")}</div>
      <div className="flex w-28 shrink-0 justify-end">{col("Size", "size", "")}</div>
    </div>
  );
}
