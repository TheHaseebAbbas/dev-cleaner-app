import type { ReactNode } from "react";
import { fmtAge, fmtBytes, type Part } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Checkbox, SizeBar } from "../ui/primitives";
import { WarnBadge } from "../ui/warnings";

/** Column layout shared by every list in the app so rows line up. The first column holds the tree. */
export const GRID = "grid grid-cols-[minmax(0,1fr)_6.5rem_8rem_4.5rem_6.5rem_9rem] items-center gap-x-3 pr-3";

/** Tree geometry in px: left padding, indent per level, chevron slot, gap, checkbox. */
const PAD = 12;
const STEP = 40;
const CHEV = 18;
const GAP = 6;
const BOX = 16;
const guideX = (level: number) => PAD + level * STEP + CHEV + GAP + BOX / 2;

/** Vertical lines drawn behind a row, one per ancestor level, so the hierarchy reads at a glance. */
function Guides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, l) => (
        <span key={l} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-slate-300 dark:bg-slate-600" style={{ left: guideX(l) }} />
      ))}
    </>
  );
}

const indent = (depth: number) => ({ paddingLeft: PAD + depth * STEP });

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
  const [first, ...rest] = props.columns;
  const sortBtn = (c: (typeof props.columns)[number]) => (
    <button key={c.label} disabled={!c.sortKey} onClick={() => c.sortKey && props.onSort?.(c.sortKey)} className={`flex items-center gap-1 ${c.align === "right" ? "justify-end" : ""} ${c.sortKey ? "cursor-pointer hover:text-slate-900 dark:hover:text-white" : "cursor-default"}`}>
      {c.label}
      {c.sortKey && props.sortKey === c.sortKey && <Icon name="chevron-down" className={`h-3 w-3 ${props.desc ? "" : "rotate-180"}`} />}
    </button>
  );
  return (
    <div className={`${GRID} sticky top-0 z-10 border-b-2 bg-slate-200 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 divider dark:bg-slate-800 dark:text-slate-300`}>
      <div className="flex items-center" style={{ paddingLeft: PAD + CHEV + GAP, gap: GAP }}>
        {props.onToggleAll ? <Checkbox checked={!!props.allChecked} indeterminate={props.someChecked} onChange={props.onToggleAll} label="Select all" /> : <span style={{ width: BOX }} />}
        {sortBtn(first)}
      </div>
      {rest.map(sortBtn)}
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
  return (
    <div className="border-b divider">
      <div
        onClick={props.onFocus}
        className={`${GRID} relative cursor-pointer py-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/60 ${props.focused ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-white dark:bg-slate-900"} ${m.dim ? "opacity-60" : ""}`}
      >
        <Guides depth={depth} />
        <div className="relative flex min-w-0 items-start" style={{ ...indent(depth), gap: GAP }}>
          <span className="flex shrink-0 justify-center" style={{ width: CHEV }}>
            {hasParts && (
              <button className="mt-px rounded p-0.5 text-slate-500 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700" aria-expanded={props.expanded} aria-label={props.expanded ? "Hide parts" : "Show parts"} onClick={(e) => { e.stopPropagation(); props.onExpand(); }}>
                <Icon name={props.expanded ? "chevron-down" : "chevron-right"} className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          <span className="mt-0.5 shrink-0">
            <Checkbox checked={props.checked} indeterminate={props.partial} disabled={m.protected || !!m.lockedReason} onChange={props.onToggle} label={`Select ${m.name}`} title={m.lockedReason ?? (m.protected ? "Protected paths cannot be removed" : undefined)} />
          </span>
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
        <div className="border-t divider">
          <div className={`${GRID} relative bg-slate-100 py-1.5 text-xs dark:bg-slate-800/80`}>
            <Guides depth={depth + 1} />
            <div className="muted flex items-center justify-between gap-3" style={indent(depth + 1)}>
              <span style={{ paddingLeft: CHEV + GAP }}>{props.partsLocked ? "The whole folder is selected, so all parts will be removed." : "Tick only the parts you want to remove."}</span>
              {!props.partsLocked && (
                <span className="flex shrink-0 gap-3">
                  <button className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => props.onSelectAllParts(true)}>Select all</button>
                  <button className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => props.onSelectAllParts(false)}>Clear</button>
                </span>
              )}
            </div>
          </div>
          {m.parts.map((p) => {
            const checked = props.partsLocked || props.selectedParts.has(p.path);
            return (
              <div key={p.path} className={`${GRID} relative border-t py-2 divider hover:bg-slate-100 dark:hover:bg-slate-800/60 ${checked ? "bg-emerald-50/70 dark:bg-emerald-950/30" : "bg-slate-50 dark:bg-slate-950/50"}`}>
                <Guides depth={depth + 1} />
                <div className="relative flex min-w-0 items-center" style={{ ...indent(depth + 1), gap: GAP }}>
                  <span className="shrink-0" style={{ width: CHEV }} />
                  <Checkbox checked={checked} disabled={props.partsLocked || m.protected || m.viewOnly} onChange={() => props.onTogglePart(p)} label={`Select ${p.name}`} />
                  <Icon name="folder" className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-400" />
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

/** A collapsible group header row (project or category). Always the top level of the tree. */
export function GroupHeader(props: { icon: "folder" | "box"; title: string; sub?: string; count: number; bytes: number; open: boolean; onToggleOpen: () => void; checked?: boolean; partial?: boolean; onToggle?: () => void; countLabel: string }) {
  return (
    <div className={`${GRID} cursor-pointer border-b-2 bg-slate-200/80 py-2.5 divider hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/70`} onClick={props.onToggleOpen}>
      <div className="flex min-w-0 items-center" style={{ paddingLeft: PAD, gap: GAP }}>
        <span className="flex shrink-0 justify-center text-slate-600 dark:text-slate-300" style={{ width: CHEV }}>
          <Icon name={props.open ? "chevron-down" : "chevron-right"} className="h-4 w-4" />
        </span>
        {props.onToggle ? <Checkbox checked={!!props.checked} indeterminate={props.partial} onChange={props.onToggle} label={`Select all in ${props.title}`} /> : <span style={{ width: BOX }} />}
        <Icon name={props.icon} className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="truncate font-semibold">{props.title}</span>
        {props.sub && <span className="muted truncate text-xs" title={props.sub}>{props.sub}</span>}
      </div>
      <span className="muted text-xs">{props.count} {props.countLabel}</span>
      <span className="text-right font-semibold tabular-nums">{fmtBytes(props.bytes)}</span>
      <span /><span /><span />
    </div>
  );
}
