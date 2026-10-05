import { useEffect, useState } from "react";
import { api, fmtBytes, type DeleteOutcome, type Item, type Locations, type Rule, type Settings } from "../api";
import { Icon } from "../ui/Icon";
import { Badge, Modal, Spinner } from "../ui/primitives";
import { needsAck, WarningPanel, type WarnEntry } from "../ui/warnings";

export interface PlanEntry extends WarnEntry { bytes: number }

export function ConfirmDialog(props: { entries: PlanEntry[]; settings: Settings; busy: boolean; onConfirm: () => void; onCancel: () => void; what?: string }) {
  const [ack, setAck] = useState(false);
  const bytes = props.entries.reduce((s, e) => s + e.bytes, 0);
  const dry = props.settings.dry_run;
  const permanent = props.settings.delete_mode === "permanent";
  const blocked = needsAck(props.entries) && !ack && !dry;
  const flagged = needsAck(props.entries);
  const explain = dry
    ? <>Nothing will be deleted.<br />This will only show what would be removed.</>
    : permanent
      ? <>These folders will be deleted permanently<br />and cannot be restored.</>
      : <>These folders will be moved to the Trash.<br />You can restore them later.</>;
  return (
    <Modal
      title={dry ? "Simulate removing these folders?" : "Remove these folders?"}
      subtitle={`${props.entries.length} folder${props.entries.length === 1 ? "" : "s"} · ${fmtBytes(bytes)}`}
      width="max-w-xl"
      onClose={props.onCancel}
      footer={<>
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        <button className={`btn ${permanent && !dry ? "btn-danger" : "btn-primary"}`} disabled={blocked || props.busy} onClick={props.onConfirm}>
          {props.busy && <Spinner />}{flagged && !dry ? "Continue" : dry ? "Simulate" : permanent ? "Delete permanently" : "Move to Trash"}
        </button>
      </>}
    >
      <p className="text-[13px]">{explain}</p>
      <div className="mt-3 max-h-56 overflow-auto rounded-[10px] border divider">
        {props.entries.map((e) => (
          <div key={e.path} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
            <span className="mono break-all">{e.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{fmtBytes(e.bytes)}</span>
          </div>
        ))}
      </div>
      <WarningPanel entries={props.entries} ack={ack} onAck={setAck} dryRun={dry} />
      {!flagged && <p className="mt-3 flex items-center gap-2 text-[13px]"><Icon name="check-circle" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{props.what ?? "Source code is not touched"}</p>}
    </Modal>
  );
}

export function ResultDialog({ result, onClose }: { result: DeleteOutcome[]; onClose: () => void }) {
  const ok = result.filter((r) => r.ok);
  const bad = result.filter((r) => !r.ok);
  const freed = ok.reduce((s, r) => s + r.bytes_freed, 0);
  const dry = result[0]?.dry_run;
  return (
    <Modal title={dry ? "Simulation finished" : bad.length ? "Finished with some problems" : "Done"} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bad.length && !ok.length ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"}`}><Icon name={bad.length && !ok.length ? "x-circle" : "check-circle"} className="h-6 w-6" /></div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtBytes(freed)}</div>
          <div className="text-sm font-medium">{dry ? "would be reclaimed" : "reclaimed"}</div><div className="muted text-[13px]">{ok.length} of {result.length} folders {dry ? "would be removed" : "removed successfully"}.</div>
        </div>
      </div>
      {bad.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-sm font-semibold">{bad.length} folder{bad.length === 1 ? "" : "s"} could not be removed</div>
          <ul className="max-h-48 space-y-1.5 overflow-auto text-xs">
            {bad.map((r) => (
              <li key={r.path} className="rounded-lg border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
                <div className="break-all font-mono">{r.path}</div>
                <div className="text-red-700 dark:text-red-300">{r.error}</div>
              </li>
            ))}
          </ul>
          <p className="muted mt-2 text-xs">Files in use are the usual reason. Close the programs that use them (editors, dev servers, emulators) and scan again.</p>
        </div>
      )}
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
          A folder is picked only when it matches one of the {active.length} active rules <em>and</em> its project file sits next to it. So <code>node_modules</code> counts only beside a <code>package.json</code>. Your own source files are never selected.
        </>)}
        {step(3, "You choose, then confirm", <>
          Tick folders (or single parts of a folder). Before anything happens you see the exact paths. {props.settings.delete_mode === "trash" ? "They move to the Trash, so you can put them back from the Trash tab." : "They are deleted permanently."} Each one comes back with its restore command, such as <code>npm install</code>.
        </>)}
        {step(4, "Risky things are flagged", <>
          <Badge tone="amber" icon="alert">Check first</Badge> means think twice (not in .gitignore, changed in the last 3 days, a version other projects may use). <Badge tone="red" icon="alert">May be required</Badge> means it may be needed or impossible to recreate (tracked by git, a Python environment with no requirements file, your default Rust toolchain, emulators, Xcode archives). For those you must tick an extra box.
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
  for (const g of loc?.global ?? []) byCategory.set(g.category, [...(byCategory.get(g.category) ?? []), g]);
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
                      <span className="w-48 shrink-0 truncate font-medium">{g.name}</span>
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
