import { api, ageDays, CATEGORY_LABEL, CONFIDENCE_LABEL, COST_LABEL, fmtAge, fmtBytes, GIT_LABEL, RISK_LABEL, type GlobalCache, type Item } from "../api";
import { Icon } from "../ui/Icon";
import { Badge } from "../ui/primitives";
import { BlockBadge, ReasonList, RiskBadge, VerdictBadge, WarningLines } from "../ui/warnings";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-[13px] last:border-0 divider">
      <span className="muted shrink-0">{k}</span>
      <span className="break-all text-right tabular-nums">{v}</span>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-4 text-[13px] font-semibold">{children}</h4>;
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{children}</code>;

/** Right-hand panel for the focused folder or location: verdict and reasons first, technical details on demand. */
export function Details({ item, cache, onClose }: { item?: Item; cache?: GlobalCache; onClose: () => void }) {
  const s = item ?? cache!;
  const name = item ? item.rule_name : cache!.name;
  const desc = item ? item.description || item.rule_name : cache!.note;
  const parts = s.parts.length;
  const reclaim = s.reclaimable_bytes || s.disk_bytes;
  return (
    <aside aria-label={`Details for ${name}`} className="float rise flex w-[360px] shrink-0 flex-col self-start overflow-hidden max-[1099px]:fixed max-[1099px]:bottom-4 max-[1099px]:right-4 max-[1099px]:top-4 max-[1099px]:z-30 max-[1099px]:self-auto lg:max-h-[calc(100vh-9rem)]">
      <div className="flex items-start justify-between gap-2 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">{s.ecosystem} · {CATEGORY_LABEL[s.category]}</div>
          <h3 className="mt-0.5 truncate text-lg font-semibold">{name}</h3>
          <div className="muted truncate text-[13px]">{item ? `in ${item.project_name}` : cache!.group}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[28px] font-bold leading-none tabular-nums">{fmtBytes(s.disk_bytes)}</span>
          <span className="muted text-[13px] tabular-nums">{s.file_count.toLocaleString()} files</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <BlockBadge block={s.block} />
          {!(cache?.info_only) && <VerdictBadge rec={s.recommendation} block={s.block} />}
          <RiskBadge risk={s.risk} />
          {parts > 0 && <Badge icon="layers">{parts} part{parts === 1 ? "" : "s"}</Badge>}
        </div>

        {s.block && (
          <div className="mt-3 flex gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/50">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{s.block.reason}</span>
          </div>
        )}

        {!s.block && s.recommendation.reasons.length > 0 && !(cache?.info_only) && (
          <>
            <H>Why {s.recommendation.verdict === "recommended" ? "it is recommended" : s.recommendation.verdict === "keep" ? "you may want to keep it" : "to review it first"}</H>
            <ReasonList reasons={s.recommendation.reasons} />
          </>
        )}

        <H>What is this?</H>
        <p className="text-[13px] leading-relaxed">{desc}</p>

        {item && item.detection.length > 0 && (
          <>
            <H>Why it was detected</H>
            <ReasonList reasons={item.detection} />
          </>
        )}

        <H>What happens if I remove it?</H>
        <p className="text-[13px] leading-relaxed">{s.consequence || "It is recreated when needed."}</p>
        {s.regenerates_with && <p className="mt-1 text-[13px] leading-relaxed">To get it back: <Code>{s.regenerates_with}</Code></p>}

        {s.warnings.length > 0 && <><H>Before you remove it</H><WarningLines warnings={s.warnings} /></>}

        <H>Cost of removing it</H>
        <div className="rounded-lg border px-3 py-1 divider">
          <Row k="Risk" v={RISK_LABEL[s.risk]} />
          <Row k="Rebuild time" v={COST_LABEL[s.rebuild_cost]} />
          <Row k="Downloads" v={COST_LABEL[s.network_cost]} />
          {s.download_bytes > 0 && <Row k="May re-download" v={`about ${fmtBytes(s.download_bytes)}`} />}
          {item && <Row k="Confidence" v={CONFIDENCE_LABEL[item.confidence]} />}
          {item && <Row k="Git" v={GIT_LABEL[item.git]} />}
          {item && <Row k="Project last active" v={`${fmtAge(item.project_last_modified)}${ageDays(item.project_last_modified) < 3 ? " (recent)" : ""}`} />}
          {cache && <Row k="Version usage" v={cache.references_checked ? "Checked against scanned projects" : "Not checked (scan projects first)"} />}
        </div>

        <details className="group mt-4 rounded-lg border divider">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-semibold">
            Storage details <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t px-3 py-1 divider">
            <Row k="Size on disk" v={fmtBytes(s.disk_bytes)} />
            <Row k="Apparent size" v={fmtBytes(s.apparent_bytes)} />
            <Row k="Estimated reclaim" v={<span title="Files hard-linked from outside this folder do not free space.">{fmtBytes(reclaim)}</span>} />
            <Row k="Files" v={s.file_count.toLocaleString()} />
            {item && <Row k="Folders" v={item.dir_count.toLocaleString()} />}
            <Row k="Changed" v={fmtAge(s.last_modified)} />
            {item && <Row k="Rule" v={<code className="text-xs">{item.rule_id} v{item.rule_version}</code>} />}
            {item && item.package_path !== item.project_path && <Row k="Package" v={<code className="text-xs">{item.package_path}</code>} />}
            <Row k="Score" v={`${s.recommendation.score} / 100`} />
            <Row k="Path" v={<code className="text-xs">{s.path}</code>} />
          </div>
        </details>

        <button className="btn mt-4 w-full" onClick={() => api.revealPath(s.path)}><Icon name="external" className="h-4 w-4" />Show in File Manager</button>
      </div>
    </aside>
  );
}
