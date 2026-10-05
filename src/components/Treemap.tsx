import { fmtBytes, type Item } from "../api";

interface Rect { x: number; y: number; w: number; h: number; item: Item }

/** Balanced binary-split treemap; items must be sorted by size descending. */
function layout(items: Item[], x: number, y: number, w: number, h: number, out: Rect[]) {
  if (items.length === 0 || w <= 0 || h <= 0) return;
  if (items.length === 1) {
    out.push({ x, y, w, h, item: items[0] });
    return;
  }
  const total = items.reduce((s, i) => s + i.disk_bytes, 0) || 1;
  let acc = 0;
  let split = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].disk_bytes;
    split = i + 1;
    if (acc >= total / 2) break;
  }
  const a = items.slice(0, split);
  const b = items.slice(split);
  const frac = a.reduce((s, i) => s + i.disk_bytes, 0) / total;
  if (w >= h) {
    layout(a, x, y, w * frac, h, out);
    layout(b, x + w * frac, y, w * (1 - frac), h, out);
  } else {
    layout(a, x, y, w, h * frac, out);
    layout(b, x, y + h * frac, w, h * (1 - frac), out);
  }
}

const COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#a78bfa", "#d97706", "#64748b", "#db2777", "#65a30d", "#0891b2", "#ea580c"];

export function Treemap(props: { items: Item[]; selected: string | null; onSelect: (path: string) => void }) {
  const sorted = [...props.items].filter((i) => i.disk_bytes > 0).sort((a, b) => b.disk_bytes - a.disk_bytes).slice(0, 200);
  const rects: Rect[] = [];
  layout(sorted, 0, 0, 100, 100, rects);
  const ecosystems = [...new Set(sorted.map((i) => i.ecosystem))];
  return (
    <div>
    <div className="mb-2 flex flex-wrap gap-3 text-xs">
      {ecosystems.map((e, i) => <span key={e} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{e}</span>)}
    </div>
    <div className="relative h-[28rem] w-full overflow-hidden rounded-[10px] border divider">
      {rects.map((r) => {
        const color = COLORS[ecosystems.indexOf(r.item.ecosystem) % COLORS.length];
        const big = r.w > 8 && r.h > 10;
        return (
          <button
            key={r.item.path}
            title={`${r.item.rule_name}\n${r.item.ecosystem}\n${fmtBytes(r.item.disk_bytes)}`}
            aria-label={`${r.item.rule_name} in ${r.item.project_name}, ${fmtBytes(r.item.disk_bytes)}`}
            onClick={() => props.onSelect(r.item.path)}
            className="absolute overflow-hidden border border-white/40 p-1 text-left text-[11px] leading-tight text-white dark:border-black/30"
            style={{
              left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`,
              background: color, opacity: 0.88,
              outline: props.selected === r.item.path ? "3px solid white" : "none",
              outlineOffset: -3,
            }}
          >
            {big && (
              <>
                <div className="truncate font-semibold">{r.item.project_name}</div>
                <div className="truncate opacity-90">{r.item.rule_name} · {fmtBytes(r.item.disk_bytes)}</div>
              </>
            )}
          </button>
        );
      })}
      {rects.length === 0 && <div className="muted p-6 text-sm">Nothing to show yet.</div>}
    </div>
    </div>
  );
}
