import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../ui/Icon";

export interface PaletteCommand { id: string; label: string; hint?: string; icon: IconName; run: () => void }

/** Ctrl/Cmd+K: type to filter, arrow keys to move, Enter to run, Escape to close. */
export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const list = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase())), [commands, q]);
  const go = (c: PaletteCommand | undefined) => { if (!c) return; onClose(); c.run(); };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/40 px-4 pt-[14vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="float rise w-full max-w-lg overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); go(list[idx]); }
        }}>
        <div className="flex items-center gap-2 border-b px-4 py-3 divider">
          <Icon name="command" className="h-4 w-4 text-slate-400" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Type a command..." aria-label="Command" className="flex-1 bg-transparent outline-none placeholder:text-slate-400" />
        </div>
        <ul role="listbox" className="max-h-72 overflow-auto p-1.5">
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === idx}>
              <button onMouseEnter={() => setIdx(i)} onClick={() => go(c)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] ${i === idx ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200" : ""}`}>
                <Icon name={c.icon} className="h-4 w-4 shrink-0" /><span className="flex-1">{c.label}</span>{c.hint && <span className="muted text-xs">{c.hint}</span>}
              </button>
            </li>
          ))}
          {!list.length && <li className="muted px-3 py-6 text-center text-[13px]">No matching commands.</li>}
        </ul>
      </div>
    </div>
  );
}
