import { api, CONFIDENCE_LABEL, COST_LABEL, fmtAge, fmtBytes, GIT_LABEL, kindLine, RISK_LABEL, VERDICT_LABEL, type GlobalCache, type Item, type Settings } from "../api";
import { checksFor } from "../ui/checks";
import { Icon } from "../ui/Icon";
import { Disclosure } from "../ui/primitives";
import { CheckList, ReasonList, WarningLines } from "../ui/warnings";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-xs last:border-0 divider">
      <span className="muted shrink-0">{k}</span>
      <span className="min-w-0 break-all text-right tabular-nums">{v}</span>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1.5 mt-5 text-[13px] font-semibold">{children}</h4>;
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{children}</code>;

const USE_STATUS = { in_use: "In use", not_detected: "Not detected", unknown: "Could not check on this system" };

/**
 * Right-hand panel for the focused folder or location. Primary information first (size, safety,
 * what removing it does, where it is); rule, Git, filesystem and scoring details on demand.
 */
export function Details({ item, cache, settings, onClose }: { item?: Item; cache?: GlobalCache; settings: Settings; onClose: () => void }) {
  const s = item ?? cache!;
  const viewOnly = !!cache?.info_only;
  const name = item ? item.rule_name : cache!.name;
  const desc = item ? item.description || item.rule_name : cache!.note;
  const checks = checksFor({ ...s, git: item?.git, viewOnly }, true);
  const verdicts = settings.recommendations_enabled && !viewOnly && !s.block;
  const reclaim = settings.show_reclaim_estimate ? s.reclaimable_bytes || s.disk_bytes : s.disk_bytes;
  const ws = item?.workspace;
  return (
    <aside aria-label={`Details for ${name}`} className="rise flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[10px] border bg-white divider dark:bg-slate-900 max-[1099px]:fixed max-[1099px]:bottom-3 max-[1099px]:right-3 max-[1099px]:top-3 max-[1099px]:z-30 max-[1099px]:shadow-2xl">
      <div className="flex items-start justify-between gap-2 px-5 pb-1 pt-4">
        <div className="min-w-0">
          <div className="muted truncate text-xs">{kindLine(s.ecosystem, s.category)}</div>
          <h3 className="mt-0.5 truncate text-lg font-semibold" title={name}>{name}</h3>
          {item && <div className="muted truncate text-[13px]">in {item.project_name}{ws && ws.member ? ` · ${ws.member}` : ""}</div>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close details" title="Close (Esc)"><Icon name="x" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-[28px] font-semibold leading-none tabular-nums">{fmtBytes(s.disk_bytes)}</span>
          <span className="muted text-[13px] tabular-nums">{s.file_count.toLocaleString()} files</span>
        </div>
        {settings.show_reclaim_estimate && reclaim < s.disk_bytes && !viewOnly && (
          <div className="muted mt-1 text-xs" title="Files hard-linked from somewhere else stay on disk.">About {fmtBytes(reclaim)} comes back when it is removed.</div>
        )}

        <div className="mt-4"><CheckList checks={checks} /></div>

        {s.block && !viewOnly && (
          <div className="mt-3 flex gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/50">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{s.block.reason}</span>
          </div>
        )}
        {s.warnings.length > 0 && <div className="mt-3"><WarningLines warnings={s.warnings} /></div>}

        <H>{viewOnly ? "What is this?" : "What happens if you remove it"}</H>
        <p className="text-[13px] leading-relaxed">{viewOnly ? desc : s.consequence || "It is recreated when it is needed."}</p>
        {!viewOnly && s.regenerates_with && <p className="mt-1.5 text-[13px] leading-relaxed">To get it back: <Code>{s.regenerates_with}</Code></p>}
        {!viewOnly && settings.show_network_recovery_cost && s.download_bytes > 0 && (
          <p className="muted mt-1.5 text-xs">Getting it back may download about {fmtBytes(s.download_bytes)}.</p>
        )}

        {verdicts && s.recommendation.reasons.length > 0 && (
          <>
            <H>{VERDICT_LABEL[s.recommendation.verdict]}{s.recommendation.verdict === "recommended" ? ": why it is safe to remove" : s.recommendation.verdict === "keep" ? ": why you may want to keep it" : ": what to check first"}</H>
            <ReasonList reasons={s.recommendation.reasons} />
          </>
        )}

        <H>Location</H>
        <div className="mono break-all rounded-lg bg-slate-100 px-2.5 py-2 text-xs dark:bg-slate-800">{s.path}</div>
        <button className="btn mt-2 w-full" onClick={() => api.revealPath(s.path)}><Icon name="external" className="h-4 w-4" />Show in File Manager</button>

        <Disclosure className="mt-5" title="Advanced details">
          <div className="rounded-lg border px-3 py-0.5 divider">
            {item && <Row k="Rule" v={<code>{item.rule_id} v{item.rule_version}</code>} />}
            {cache && <Row k="Location id" v={<code>{cache.id}</code>} />}
            {item && <Row k="What it is" v={<span className="text-left">{desc}</span>} />}
            {item && item.package_path && <Row k="Package" v={<code>{item.package_path}</code>} />}
            {ws && <Row k="Workspace" v={`${ws.kind} workspace${ws.member ? `, member ${ws.member}` : " root"}`} />}
            {item && <Row k="Git" v={GIT_LABEL[item.git]} />}
            {item && <Row k="Detection confidence" v={CONFIDENCE_LABEL[item.confidence]} />}
            <Row k="Risk" v={RISK_LABEL[s.risk]} />
            <Row k="Rebuild time" v={COST_LABEL[s.rebuild_cost]} />
            <Row k="Downloads to get it back" v={COST_LABEL[s.network_cost]} />
            <Row k="Size on disk" v={fmtBytes(s.disk_bytes)} />
            <Row k="Apparent size" v={fmtBytes(s.apparent_bytes)} />
            <Row k="Estimated reclaim" v={fmtBytes(s.reclaimable_bytes || s.disk_bytes)} />
            {item && <Row k="Folders" v={item.dir_count.toLocaleString()} />}
            <Row k="Last changed" v={fmtAge(s.last_modified)} />
            {item && <Row k="Project last active" v={fmtAge(item.project_last_modified)} />}
            {s.in_use && <Row k="Programs using it" v={s.in_use.status === "in_use" ? s.in_use.by.join(", ") || "Locked files" : USE_STATUS[s.in_use.status]} />}
            {cache && <Row k="Version usage" v={cache.references_checked ? "Checked against scanned projects" : "Not checked (scan projects first)"} />}
            {settings.recommendations_enabled && !viewOnly && <Row k="Score" v={`${s.recommendation.score} / 100`} />}
          </div>
          {item && item.detection.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold">Why it was detected</div>
              <ReasonList reasons={item.detection} />
            </div>
          )}
        </Disclosure>
      </div>
    </aside>
  );
}
