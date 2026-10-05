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
  const mode = dry ? "Nothing will be deleted (dry run)." : props.settings.delete_mode === "trash" ? "They move to the Trash, so you can put them back from the Trash tab." : "They are deleted permanently and cannot be restored.";
  const blocked = needsAck(props.entries) && !ack && !dry;
  return (
    <Modal
      title={dry ? "Simulate removing these folders?" : "Remove these folders?"}
      subtitle={`${props.entries.length} folder${props.entries.length === 1 ? "" : "s"} · ${fmtBytes(bytes)}`}
      width="max-w-xl"
      onClose={props.onCancel}
      footer={<>
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        <button className="btn btn-danger" disabled={blocked || props.busy} onClick={props.onConfirm}>
          {props.busy && <Spinner />}{dry ? "Simulate" : props.settings.delete_mode === "trash" ? "Move to Trash" : "Delete permanently"}
        </button>
      </>}
    >
      <p>{mode} {props.what ?? "Your source code and other project files are not touched."}</p>
      <div className="mt-3 max-h-56 overflow-auto rounded-lg border divider">
        {props.entries.map((e) => (
          <div key={e.path} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs last:border-0 divider">
            <span className="break-all font-mono">{e.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{fmtBytes(e.bytes)}</span>
          </div>
        ))}
      </div>
      <WarningPanel entries={props.entries} ack={ack} onAck={setAck} dryRun={dry} />
    </Modal>
  );
}

export function ResultDialog({ result, onClose }: { result: DeleteOutcome[]; onClose: () => void }) {
  const ok = result.filter((r) => r.ok);
  const bad = result.filter((r) => !r.ok);
  const freed = ok.reduce((s, r) => s + r.bytes_freed, 0);
  const dry = result[0]?.dry_run;
  return (
    <Modal title={dry ? "Simulation finished" : bad.length ? "Finished with some problems" : "Done"} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>OK</button>}>
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bad.length && !ok.length ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40"}`}><Icon name={bad.length && !ok.length ? "x-circle" : "check-circle"} className="h-6 w-6" /></div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmtBytes(freed)}</div>
          <div className="muted text-sm">{dry ? "would be freed" : "freed"} · {ok.length} of {result.length} folders</div>
        </div>
      </div>
      {bad.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-sm font-semibold">Could not remove ({bad.length})</div>
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
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">{n}</div>
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
                    <Icon name="folder" className="h-4 w-4 text-emerald-600" />
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
