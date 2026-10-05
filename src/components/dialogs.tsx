import { useEffect, useState } from "react";
import { api, fmtBytes, type DeleteReport, type Item, type Locations, type OutcomeKind, type Preview, type Rule, type Settings } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Modal, Spinner } from "../ui/primitives";
import { needsAck, WarningPanel, type WarnEntry } from "../ui/warnings";

export interface PlanEntry extends WarnEntry { bytes: number }

const CONFIRM_WORD = "DELETE";

/**
 * Confirmation for a cleanup. The preview comes from the backend, which re-checks every target
 * against the scan, so what is shown here is what will be attempted.
 */
export function ConfirmDialog(props: { entries: PlanEntry[]; preview: Preview | null; settings: Settings; busy: boolean; onConfirm: (ack: boolean) => void; onCancel: () => void; what?: string }) {
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const pv = props.preview;
  const dry = props.settings.dry_run;
  const permanent = props.settings.delete_mode === "permanent";
  const flagged = needsAck(props.entries) || !!pv?.needs_ack;
  const typedNeeded = !!pv?.critical && permanent && !dry;
  const ready = pv ? pv.ready : props.entries.length;
  const blocked = !pv || ready === 0 || (flagged && !ack && !dry) || (typedNeeded && typed.trim() !== CONFIRM_WORD);
  const staleMin = pv ? Math.floor(pv.scan_age_secs / 60) : 0;
  const stale = staleMin >= props.settings.stale_scan_minutes;
  const explain = dry
    ? <>Nothing will be deleted.<br />This will only show what would be removed.</>
    : permanent
      ? <>These will be deleted permanently and cannot be restored.</>
      : <>These will be moved to the Trash, so you can restore them later.<br /><span className="muted">Disk space comes back when the Trash is emptied.</span></>;
  const stat = (label: string, value: React.ReactNode) => <div><div className="muted text-[11px] uppercase tracking-wide">{label}</div><div className="font-semibold tabular-nums">{value}</div></div>;
  return (
    <Modal
      title={dry ? "Simulate this cleanup?" : "Remove these items?"}
      subtitle={pv ? `${ready} of ${pv.selected} ready · about ${fmtBytes(pv.estimated_bytes)} to reclaim` : "Checking the selection…"}
      width="max-w-xl"
      onClose={props.onCancel}
      footer={<>
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        <button className={`btn ${permanent && !dry ? "btn-danger" : "btn-primary"}`} disabled={blocked || props.busy} onClick={() => props.onConfirm(ack || dry)}>
          {props.busy && <Spinner />}{dry ? "Simulate" : permanent ? "Delete permanently" : "Move to Trash"}
        </button>
      </>}
    >
      {!pv ? <div className="flex justify-center py-6"><Spinner className="h-6 w-6" /></div> : (
        <>
          <p className="text-[13px]">{explain}</p>
          <div className="mt-3 grid grid-cols-4 gap-3 rounded-[10px] border p-3 text-[13px] divider">
            {stat("Reclaim", fmtBytes(pv.estimated_bytes))}
            {stat("Re-download", pv.download_bytes ? fmtBytes(pv.download_bytes) : "None")}
            {stat("Projects", pv.projects)}
            {stat("With warnings", pv.with_warnings)}
          </div>
          {(pv.review > 0 || pv.keep > 0 || pv.in_use > 0) && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {[pv.review ? `${pv.review} marked Review` : "", pv.keep ? `${pv.keep} marked Keep` : "", pv.in_use ? `${pv.in_use} used by a scanned project` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          {stale && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><Icon name="clock" className="h-3.5 w-3.5" />This scan is {staleMin} minutes old. Each item is checked again before it is removed.</p>}
          <div className="mt-3 max-h-48 overflow-auto rounded-[10px] border divider">
            {props.entries.map((e) => (
              <div key={e.path} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
                <span className="mono break-all">{e.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{fmtBytes(e.bytes)}</span>
              </div>
            ))}
          </div>
          {pv.problems.length > 0 && (
            <div className="mt-3 rounded-[10px] border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold"><Icon name="lock" className="h-4 w-4" />{pv.problems.length} will be skipped</div>
              <ul className="max-h-32 space-y-1.5 overflow-auto text-xs">
                {pv.problems.map((o) => <li key={o.id + o.path}><span className="mono break-all">{o.path}</span><div className="muted">{o.error}</div></li>)}
              </ul>
            </div>
          )}
          <WarningPanel entries={props.entries} ack={ack} onAck={setAck} dryRun={dry} forceAck={pv.needs_ack} />
          {typedNeeded && (
            <label className="mt-3 block text-[13px]">
              <span className="font-medium">This includes data that may be impossible to recreate. Type {CONFIRM_WORD} to delete it permanently.</span>
              <input className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${CONFIRM_WORD} to confirm`} />
            </label>
          )}
          {!flagged && !pv.problems.length && <p className="mt-3 flex items-center gap-2 text-[13px]"><Icon name="check-circle" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{props.what ?? "Source code is not touched"}</p>}
        </>
      )}
    </Modal>
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

const REPO_URL = "https://github.com/TheHaseebAbbas/dev-cleaner-app";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(REPO_URL).then(() => setCopied(true), () => {}); };
  const point = (title: string, body: string) => (
    <li className="flex gap-2.5 text-[13px]">
      <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span><span className="font-medium">{title}</span> <span className="muted">{body}</span></span>
    </li>
  );
  return (
    <Modal title="About Dev Cleaner" width="max-w-lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="flex items-center gap-4">
        <img src="/icon.svg" alt="" className="h-16 w-16" />
        <div>
          <div className="text-xl font-semibold tracking-tight">Dev Cleaner</div>
          <div className="muted text-[13px]">Version {__APP_VERSION__}</div>
          <div className="muted text-[13px]">Windows, macOS and Linux</div>
        </div>
      </div>
      <p className="mt-4 text-[13px]">
        Finds and removes the files developer tools leave behind, such as <code>node_modules</code>, build output, package caches, SDK downloads and simulators, so you can reclaim disk space without touching your source code.
      </p>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Built to be safe</h3>
      <ul className="space-y-2">
        {point("Nothing is removed until you confirm.", "You see the exact folders first.")}
        {point("Removed folders go to the Trash", "so you can restore them, unless you choose permanent deletion.")}
        {point("Only rebuildable folders are offered.", "A folder must match a rule and sit beside its project file.")}
        {point("Works offline.", "No account, no telemetry. Settings and history stay on this computer.")}
      </ul>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Details</h3>
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
        <dt className="muted">Built with</dt><dd>Tauri 2, Rust, React and TypeScript</dd>
        <dt className="muted">Your data</dt><dd>settings.json and history.jsonl in the app config folder</dd>
        <dt className="muted">Shortcuts</dt><dd>Ctrl/Cmd+K opens the command palette</dd>
        <dt className="muted">License</dt><dd>GNU GPL v3.0</dd>
        <dt className="muted">Source</dt>
        <dd className="flex min-w-0 items-center gap-2"><span className="mono truncate text-xs">{REPO_URL}</span><button className="btn btn-sm shrink-0" onClick={copy}>{copied ? "Copied" : "Copy link"}</button></dd>
      </dl>
    </Modal>
  );
}
