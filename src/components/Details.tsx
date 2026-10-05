import { api, fmtAge, fmtBytes, type Item } from "../api";
import { Icon } from "../ui/Icon";
import { Badge } from "../ui/primitives";
import { WarningLines } from "../ui/warnings";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0 divider">
      <span className="muted shrink-0">{k}</span>
      <span className="break-all text-right">{v}</span>
    </div>
  );
}

export function Details({ item, onClose }: { item: Item; onClose: () => void }) {
  const git = item.git_tracked ? <Badge tone="red">tracked by git</Badge> : item.git_ignored === null ? <span className="muted">not a git repository</span> : item.git_ignored ? <Badge tone="green">git-ignored</Badge> : <Badge tone="amber">not git-ignored</Badge>;
  return (
    <aside className="card rise w-80 shrink-0 self-start overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3 divider">
        <div className="min-w-0">
          <div className="muted text-[11px] font-semibold uppercase tracking-wide">{item.ecosystem}</div>
          <h3 className="truncate font-semibold">{item.rule_name}</h3>
          <div className="muted truncate text-xs">in {item.project_name}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </div>
      <div className="max-h-[calc(100vh-14rem)] overflow-auto px-4 py-3">
        <WarningLines warnings={item.warnings} />
        <p className="mb-3 text-sm">{item.description || item.rule_name}</p>
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <div className="font-semibold">Cleaning removes only</div>
          <div className="mt-1 break-all font-mono">{item.path}</div>
          <div className="muted mt-1">Everything else in the project stays.</div>
        </div>
        <Row k="Size on disk" v={<b>{fmtBytes(item.disk_bytes)}</b>} />
        <Row k="Apparent size" v={fmtBytes(item.apparent_bytes)} />
        <Row k="Files / folders" v={`${item.file_count.toLocaleString()} / ${item.dir_count.toLocaleString()}`} />
        <Row k="Folder changed" v={fmtAge(item.last_modified)} />
        <Row k="Project last active" v={fmtAge(item.project_last_modified)} />
        <Row k="Git" v={git} />
        <Row k="Comes back with" v={<code>{item.regenerates_with}</code>} />
        {item.protected && <Row k="Protected" v={<Badge icon="lock">yes</Badge>} />}
        {item.parts.length > 0 && <p className="muted mt-2 text-xs">This folder has {item.parts.length} parts. Expand the row to remove only some of them.</p>}
        <button className="btn mt-3 w-full" onClick={() => api.revealPath(item.path)}><Icon name="external" />Show in file manager</button>
      </div>
    </aside>
  );
}
