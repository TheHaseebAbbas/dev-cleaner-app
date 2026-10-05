import { api, fmtAge, fmtBytes, type Item } from "../api";
import { Icon } from "../ui/Icon";
import { Badge } from "../ui/primitives";
import { SafetyList } from "../ui/warnings";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-[13px] last:border-0 divider">
      <span className="muted shrink-0">{k}</span>
      <span className="break-all text-right tabular-nums">{v}</span>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-4 text-[13px] font-semibold">{children}</h4>;

/** Right-hand panel for the focused folder: plain answers first, technical details on demand. */
export function Details({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <aside aria-label={`Details for ${item.rule_name}`} className="float rise flex w-[360px] shrink-0 flex-col self-start overflow-hidden max-[1099px]:fixed max-[1099px]:bottom-4 max-[1099px]:right-4 max-[1099px]:top-4 max-[1099px]:z-30 max-[1099px]:self-auto lg:max-h-[calc(100vh-9rem)]">
      <div className="flex items-start justify-between gap-2 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">{item.ecosystem}</div>
          <h3 className="mt-0.5 truncate text-lg font-semibold">{item.rule_name}</h3>
          <div className="muted truncate text-[13px]">in {item.project_name}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[28px] font-bold leading-none tabular-nums">{fmtBytes(item.disk_bytes)}</span>
          <span className="muted text-[13px] tabular-nums">{item.file_count.toLocaleString()} files</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.protected && <Badge icon="lock">Protected</Badge>}
          {item.parts.length > 0 && <Badge icon="layers">{item.parts.length} parts</Badge>}
        </div>

        <H>What is this?</H>
        <p className="text-[13px] leading-relaxed">{item.description || item.rule_name}</p>

        <H>What happens if I remove it?</H>
        <p className="text-[13px] leading-relaxed">It comes back the next time you run <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{item.regenerates_with}</code>. Your source files are not touched.</p>

        <H>Safety</H>
        <SafetyList gitIgnored={item.git_ignored} gitTracked={item.git_tracked} warnings={item.warnings} regenerates={item.regenerates_with} />
        <p className="muted mt-2 text-xs">Project last active {fmtAge(item.project_last_modified)}.</p>

        <details className="group mt-4 rounded-lg border divider">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-semibold">
            Storage details <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t px-3 py-1 divider">
            <Row k="Size on disk" v={fmtBytes(item.disk_bytes)} />
            <Row k="Apparent size" v={fmtBytes(item.apparent_bytes)} />
            <Row k="Files" v={item.file_count.toLocaleString()} />
            <Row k="Folders" v={item.dir_count.toLocaleString()} />
            <Row k="Changed" v={fmtAge(item.last_modified)} />
            <Row k="Project last active" v={fmtAge(item.project_last_modified)} />
            <Row k="Rule" v={<code className="text-xs">{item.rule_id}</code>} />
            <Row k="Path" v={<code className="text-xs">{item.path}</code>} />
          </div>
        </details>

        <button className="btn mt-4 w-full" onClick={() => api.revealPath(item.path)}><Icon name="external" className="h-4 w-4" />Show in File Manager</button>
      </div>
    </aside>
  );
}
