import { api, ageDays, fmtBytes, fmtDate, type Item } from "../api";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm dark:border-slate-800">
      <span className="text-slate-500">{k}</span>
      <span className="break-all text-right">{v}</span>
    </div>
  );
}

export function Details({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <aside className="card w-80 shrink-0 self-start">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{item.project_name}</h3>
        <button className="btn !px-2 !py-0.5" onClick={onClose}>✕</button>
      </div>
      <Row k="Artifact" v={item.rule_name} />
      <Row k="Ecosystem" v={item.ecosystem} />
      <Row k="Size on disk" v={fmtBytes(item.disk_bytes)} />
      <Row k="Apparent size" v={fmtBytes(item.apparent_bytes)} />
      <Row k="Files" v={item.file_count.toLocaleString()} />
      <Row k="Folders" v={item.dir_count.toLocaleString()} />
      <Row k="Artifact modified" v={`${fmtDate(item.last_modified)}`} />
      <Row k="Project last active" v={`${fmtDate(item.project_last_modified)} (${ageDays(item.project_last_modified)}d ago)`} />
      <Row k="Risk" v={item.risk} />
      <Row k="Git" v={item.git_ignored === null ? "not a git repo" : item.git_ignored ? "ignored (safe)" : "NOT ignored"} />
      <Row k="Restore with" v={item.regenerates_with} />
      <Row k="Protected" v={item.protected ? "yes" : "no"} />
      <div className="mt-2 break-all text-xs text-slate-500">{item.path}</div>
      <button className="btn mt-3 w-full justify-center" onClick={() => api.revealPath(item.path)}>
        Reveal in file manager
      </button>
    </aside>
  );
}
