import { useEffect, useState } from "react";
import { api, fmtBytes, type DeleteReport, type Item, type Locations, type OutcomeKind, type Preview, type Rule, type Settings } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Disclosure, Modal, Spinner } from "../ui/primitives";
import { needsAck, WarningPanel, type WarnEntry } from "../ui/warnings";

export interface PlanEntry extends WarnEntry { bytes: number }

const CONFIRM_WORD = "DELETE";

/**
 * Confirmation for a cleanup. The preview comes from the backend, which re-checks every target
 * against the scan right now, so what is shown here is what will be attempted. Plain Trash
 * cleanups get a short question; permanent deletion, risky items, programs in use and a custom
 * rule's first cleanup each ask for an explicit acknowledgement.
 */
export function ConfirmDialog(props: { entries: PlanEntry[]; preview: Preview | null; settings: Settings; busy: boolean; onConfirm: (ack: boolean) => void; onCancel: () => void; noun?: string; ruleNames?: Record<string, string> }) {
  const [ack, setAck] = useState(false);
  const [sure, setSure] = useState(false);
  const [typed, setTyped] = useState("");
  const pv = props.preview;
  const st = props.settings;
  const dry = st.dry_run;
  const permanent = st.delete_mode === "permanent" && !dry;
  const noun = props.noun ?? "folder";
  const n = pv ? pv.ready : props.entries.length;
  const plural = `${n} ${noun}${n === 1 ? "" : "s"}`;
  const flagged = needsAck(props.entries) || !!pv?.needs_ack;
  const typedNeeded = !!pv?.critical && permanent;
  const blocked = !pv || n === 0 || (flagged && !ack && !permanent && !dry) || (permanent && !sure) || (typedNeeded && typed.trim() !== CONFIRM_WORD);
  const staleMin = pv ? Math.floor(pv.scan_age_secs / 60) : 0;
  const stale = staleMin >= st.stale_scan_minutes;
  const amount = pv ? fmtBytes(st.show_reclaim_estimate ? pv.estimated_bytes : pv.size_bytes) : "";
  const title = dry ? `Simulate removing ${plural}?` : permanent ? "Delete permanently?" : `Move ${plural} to Trash?`;
  const firstUse = (pv?.first_use_rules ?? []).map((id) => props.ruleNames?.[id] ?? id);
  return (
    <Modal
      title={title}
      width="max-w-lg"
      onClose={props.onCancel}
      footer={<>
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        <button className={`btn ${permanent ? "btn-danger" : "btn-primary"}`} disabled={blocked || props.busy} onClick={() => props.onConfirm(ack || sure || dry)}>
          {props.busy && <Spinner />}{dry ? "Simulate" : permanent ? "Delete permanently" : "Move to Trash"}
        </button>
      </>}
    >
      {!pv ? <div className="flex justify-center py-6"><Spinner className="h-6 w-6" /></div> : (
        <>
          {dry ? (
            <p className="text-[13px]">Dry run is on, so nothing will be deleted. You will see what would be removed and how much space it would free ({amount}).</p>
          ) : permanent ? (
            <>
              <p className="text-[13px] font-medium">This cannot be undone.</p>
              <p className="mt-1 text-[13px]">The selected {noun}s may be required by your development tools and will need to be generated or downloaded again. {amount} will be reclaimed from {plural}.</p>
            </>
          ) : (
            <p className="text-[13px]"><b className="tabular-nums">{amount}</b> will be reclaimed. The {noun}s can be restored from Trash.</p>
          )}
          {st.show_network_recovery_cost && pv.download_bytes > 0 && <p className="muted mt-1.5 text-xs">Getting them back may download up to {fmtBytes(pv.download_bytes)}.</p>}
          {stale && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><Icon name="clock" className="h-3.5 w-3.5" />This scan is {staleMin} minutes old. Each {noun} is checked again before it is removed.</p>}

          <Disclosure className="mt-3" title={`Show ${plural}`} defaultOpen={props.entries.length <= 3}>
            <div className="max-h-40 overflow-auto rounded-lg border divider">
              {props.entries.map((e) => (
                <div key={e.path} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
                  <span className="mono break-all">{e.label}</span>
                  <span className="shrink-0 tabular-nums">{fmtBytes(e.bytes)}</span>
                </div>
              ))}
            </div>
          </Disclosure>

          {pv.problems.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold"><Icon name="lock" className="h-4 w-4" />{pv.problems.length} will be skipped</div>
              <ul className="max-h-28 space-y-1.5 overflow-auto text-xs">
                {pv.problems.map((o) => <li key={o.id + o.path}><span className="mono break-all">{o.path}</span><div className="muted">{o.error}</div></li>)}
              </ul>
            </div>
          )}
          {(pv.running > 0 || firstUse.length > 0 || pv.in_use > 0) && (
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {pv.running > 0 && <li className="flex gap-2 text-red-700 dark:text-red-300"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{pv.running} {pv.running === 1 ? "is" : "are"} in use by a running program right now. Close it first, or files may be locked or recreated.</li>}
              {pv.in_use > 0 && <li className="flex gap-2 text-amber-700 dark:text-amber-300"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{pv.in_use} {pv.in_use === 1 ? "is" : "are"} used by a scanned project.</li>}
              {firstUse.length > 0 && <li className="flex gap-2 text-amber-700 dark:text-amber-300"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />First cleanup with your custom rule{firstUse.length === 1 ? "" : "s"} {firstUse.map((r) => `"${r}"`).join(", ")}. Check the list above.</li>}
            </ul>
          )}
          {!permanent && <WarningPanel entries={props.entries} ack={ack} onAck={setAck} dryRun={dry} forceAck={pv.needs_ack} />}
          {permanent && props.entries.some((e) => e.warnings.length) && <WarningPanel entries={props.entries} ack={false} onAck={() => {}} dryRun />}
          {typedNeeded && (
            <label className="mt-3 block text-[13px]">
              <span className="font-medium">This includes data that may be impossible to recreate. Type {CONFIRM_WORD} to continue.</span>
              <input className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${CONFIRM_WORD} to confirm`} />
            </label>
          )}
          {permanent && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" className="cb" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand this cannot be undone.
            </label>
          )}
        </>
      )}
    </Modal>
  );
}

/** Quiet result line after a cleanup; details open in a dialog only when asked or when nothing worked. */
export function CleanupNotice({ report, noun, onDetails, onClose }: { report: DeleteReport; noun: string; onDetails: () => void; onClose: () => void }) {
  const bad = report.outcomes.filter((o) => !o.ok).length;
  const n = report.removed;
  const what = `${n} ${noun}${n === 1 ? "" : "s"}`;
  const text = report.dry_run
    ? `Dry run: ${what} would be removed · ${fmtBytes(report.estimated_bytes)}`
    : report.mode === "trash" ? `Moved ${what} to Trash · ${fmtBytes(report.estimated_bytes)}` : `Deleted ${what} · ${fmtBytes(report.estimated_bytes)} reclaimed`;
  const failedAll = n === 0 && bad > 0;
  return (
    <div role="status" className="rise mt-3 flex items-center gap-3 rounded-[10px] border px-4 py-2.5 text-[13px] divider">
      <Icon name={failedAll ? "x-circle" : "check-circle"} className={`h-4 w-4 ${failedAll ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`} />
      <span className="min-w-0 flex-1 truncate">
        {failedAll ? "Cleanup failed. Nothing was removed." : text}
        {bad > 0 && !failedAll && <span className="text-amber-700 dark:text-amber-300"> · {bad} not removed</span>}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={onDetails}>Details</button>
      <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Dismiss"><Icon name="x" /></button>
    </div>
  );
}

const OUTCOME_TITLE: Record<OutcomeKind, string> = { removed: "Removed", failed: "Could not be removed", blocked: "Blocked by a safety check", skipped: "Skipped" };

export function ResultDialog({ report, onClose }: { report: DeleteReport; onClose: () => void }) {
  const out = report.outcomes;
  const bad = out.filter((r) => !r.ok);
  const dry = report.dry_run;
  const actual = report.volume_free_before != null && report.volume_free_after != null ? Math.max(0, report.volume_free_after - report.volume_free_before) : null;
  const nothing = report.removed === 0 && bad.length > 0;
  const groups = (["failed", "blocked", "skipped"] as OutcomeKind[]).map((k) => [k, bad.filter((r) => r.result === k)] as const).filter(([, l]) => l.length);
  return (
    <Modal title={dry ? "Simulation finished" : bad.length ? "Finished with some problems" : "Done"} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${nothing ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"}`}><Icon name={nothing ? "x-circle" : "check-circle"} className="h-6 w-6" /></div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtBytes(report.estimated_bytes)}</div>
          <div className="text-sm font-medium">{dry ? "would be reclaimed (estimate)" : report.mode === "trash" ? "moved to the Trash (estimate)" : "reclaimed (estimate)"}</div>
          <div className="muted text-[13px]">{report.removed} of {out.length} {dry ? "would be removed" : "removed"}{report.failed ? ` · ${report.failed} failed` : ""}{report.blocked ? ` · ${report.blocked} blocked` : ""}{report.skipped ? ` · ${report.skipped} skipped` : ""}.</div>
          {actual != null && !dry && <div className="muted text-xs">Free space on the disk grew by {fmtBytes(actual)}.</div>}
          {report.mode === "trash" && !dry && report.removed > 0 && <div className="muted text-xs">Space is freed when the Trash is emptied.</div>}
        </div>
      </div>
      {groups.map(([kind, list]) => (
        <div key={kind} className="mt-4">
          <div className="mb-1 text-sm font-semibold">{OUTCOME_TITLE[kind]} ({list.length})</div>
          <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
            {list.map((r) => (
              <li key={r.id + r.path} className={`rounded-lg border p-2 ${kind === "failed" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"}`}>
                <div className="break-all font-mono">{r.path}</div>
                <div className={kind === "failed" ? "text-red-700 dark:text-red-300" : "muted"} title={r.raw_error ?? undefined}>{r.error}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {report.failed > 0 && <p className="muted mt-2 text-xs">Files in use are the usual reason. Close the programs that use them (editors, dev servers, emulators) and scan again.</p>}
    </Modal>
  );
}

export function HelpDialog(props: { settings: Settings; rules: Rule[]; onOpenSettings: () => void; onClose: () => void }) {
  const active = props.rules.filter((r) => r.enabled);
  const step = (n: number, title: string, body: React.ReactNode) => (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">{n}</div>
      <div className="min-w-0"><div className="font-semibold">{title}</div><div className="muted mt-0.5">{body}</div></div>
    </div>
  );
  return (
    <Modal title="How Dev Cleaner decides what to remove" width="max-w-2xl" onClose={props.onClose} footer={<><button className="btn" onClick={() => { props.onClose(); props.onOpenSettings(); }}>Open settings</button><button className="btn btn-primary" onClick={props.onClose}>Got it</button></>}>
      <div className="space-y-4">
        {step(1, "It looks only where you tell it", <>
          Inside {props.settings.scan_roots.length ? props.settings.scan_roots.map((r) => <code key={r} className="mr-1 rounded bg-slate-100 px-1 dark:bg-slate-800">{r}</code>) : "no folders yet (add some in Settings)"}, up to {props.settings.max_depth} levels deep. Folders named {props.settings.exclude_names.map((n) => `“${n}”`).join(", ") || "(none)"} are skipped.
        </>)}
        {step(2, "It only picks folders that can be rebuilt", <>
          A folder is picked only when it matches one of the {active.length} active rules <em>and</em> its project file sits next to it. So <code>node_modules</code> counts only beside a <code>package.json</code>. Lock files and <code>.gitignore</code> make a match more certain. Your own source files are never selected.
        </>)}
        {step(3, "You choose, then confirm", <>
          Tick folders (or single parts of a folder), or use Quick select. Before anything happens Dev Cleaner checks each one again and shows what will be removed and what will be skipped. {props.settings.delete_mode === "trash" ? "They move to the Trash, so you can put them back from the Trash tab." : "They are deleted permanently."} Each one comes back with its restore command, such as <code>npm install</code>.
        </>)}
        {step(4, "Each folder gets a verdict", <>
          Every folder gets a verdict: <Badge tone="green">Recommended</Badge> (rebuilds cheaply, nothing points against it), <Badge tone="amber">Review</Badge> (fine to remove, but costs a download or rebuild, or the project was active recently) or <Badge>Keep</Badge> (used by a project, or may hold data you cannot get back). Hover a verdict to see why. <Badge icon="lock">Protected</Badge> items, folders Git tracks, system folders and anything holding signing keys cannot be selected at all. Emulators, simulators and archives need an extra confirmation.
        </>)}
      </div>
      <h3 className="mt-5 mb-1 text-sm font-semibold">Active rules</h3>
      <div className="overflow-hidden rounded-lg border divider">
        {active.map((r) => (
          <div key={r.id} className="grid grid-cols-[9rem_10rem_1fr] gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
            <span className="truncate font-mono">{r.dir_names.join(" / ")}</span>
            <span className="muted truncate">{r.parent_markers.length ? `beside ${r.parent_markers.join(" or ")}` : r.self_markers.length ? `contains ${r.self_markers.join(" or ")}` : "any project"}</span>
            <span>{r.description}{r.split ? " Can be removed in parts." : ""}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function LocationsDialog(props: { items?: Item[]; onClose: () => void; onOpenSettings: () => void }) {
  const [loc, setLoc] = useState<Locations | null>(null);
  useEffect(() => { api.getLocations().then(setLoc); }, []);
  const byCategory = new Map<string, Locations["global"]>();
  for (const g of loc?.global ?? []) byCategory.set(g.group, [...(byCategory.get(g.group) ?? []), g]);
  return (
    <Modal title="Where Dev Cleaner looks" subtitle="Nothing outside these places is ever scanned or deleted." width="max-w-3xl" onClose={props.onClose} footer={<button className="btn btn-primary" onClick={props.onClose}>Close</button>}>
      {!loc ? <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div> : (
        <div className="space-y-6">
          <section>
            <h3 className="font-semibold">Your project folders</h3>
            <p className="muted mb-2 text-xs">Scanned up to {loc.max_depth} levels deep for build folders such as node_modules, target, build and Pods. Skipped names: {loc.exclude_names.join(", ") || "none"}. Protected: {loc.protected_paths.join(", ") || "none"}.</p>
            <div className="overflow-hidden rounded-lg border divider">
              {loc.scan_roots.map((r) => {
                const found = (props.items ?? []).filter((i) => norm(i.path).startsWith(norm(r.path) + "/"));
                return (
                  <div key={r.path} className="flex items-center gap-3 border-b px-3 py-2 text-xs last:border-0 divider">
                    <Icon name="folder" className="h-4 w-4 text-indigo-600" />
                    <span className="min-w-0 flex-1 break-all font-mono">{r.path}</span>
                    <Badge tone={r.exists ? "green" : "red"}>{r.exists ? "found" : "missing"}</Badge>
                    {props.items && <span className="muted w-40 text-right">{found.length ? `${found.length} folders · ${fmtBytes(found.reduce((s, i) => s + i.disk_bytes, 0))}` : "nothing found"}</span>}
                  </div>
                );
              })}
              {!loc.scan_roots.length && <div className="px-3 py-3 text-amber-600">No folders set.</div>}
            </div>
            <button className="btn btn-sm mt-2" onClick={() => { props.onClose(); props.onOpenSettings(); }}>Change in Settings</button>
          </section>
          <section>
            <h3 className="font-semibold">Tool caches and SDKs</h3>
            <p className="muted mb-2 text-xs">
              Fixed locations for your operating system, such as AppData on Windows. The Android SDK comes from <code>ANDROID_SDK_ROOT</code> / <code>ANDROID_HOME</code>
              {loc.android_sdk_env ? <> (set to <code>{loc.android_sdk_env}</code>)</> : <> (not set, so the default location is used)</>}.
            </p>
            {[...byCategory.entries()].map(([cat, list]) => (
              <div key={cat} className="mb-3">
                <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">{cat}</div>
                <div className="overflow-hidden rounded-lg border divider">
                  {list.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
                      <span className="w-48 shrink-0 truncate font-medium" title={g.ecosystem}>{g.name}</span>
                      <span className="muted min-w-0 flex-1 break-all font-mono">{g.path}</span>
                      <Badge tone={g.exists ? "green" : "neutral"}>{g.exists ? "found" : "not installed"}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </Modal>
  );
}
