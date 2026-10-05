import { useEffect, useState } from "react";
import { api, fmtBytes, type Item, type Locations } from "../api";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{ok ? yes : no}</span>;
}

/** Lists every folder Dev Cleaner looks at, and what it found under each project folder. */
export function LocationsDialog(props: { items?: Item[]; onClose: () => void; onOpenSettings: () => void }) {
  const [loc, setLoc] = useState<Locations | null>(null);
  useEffect(() => { api.getLocations().then(setLoc); }, []);

  const byCategory = new Map<string, Locations["global"]>();
  for (const g of loc?.global ?? []) byCategory.set(g.category, [...(byCategory.get(g.category) ?? []), g]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card flex max-h-[90vh] w-[56rem] max-w-full flex-col shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Where Dev Cleaner looks</h2>
            <p className="text-sm text-slate-500">Nothing outside these places is ever scanned or deleted.</p>
          </div>
          <button className="btn !px-2 !py-0.5" onClick={props.onClose}>✕</button>
        </div>
        {!loc ? <p className="text-slate-500">Loading…</p> : (
          <div className="space-y-5 overflow-auto pr-1 text-sm">
            <section>
              <h3 className="mb-1 font-semibold">1. Your project folders (Projects tab)</h3>
              <p className="mb-2 text-slate-500">Scanned up to {loc.max_depth} levels deep for build folders like node_modules, target, build and Pods.</p>
              <table className="w-full text-xs">
                <tbody>
                  {loc.scan_roots.map((r) => {
                    const found = (props.items ?? []).filter((i) => norm(i.path).startsWith(norm(r.path) + "/"));
                    return (
                      <tr key={r.path} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="break-all px-2 py-1.5 font-mono">{r.path}</td>
                        <td className="px-2 py-1.5"><Badge ok={r.exists} yes="found" no="missing" /></td>
                        {props.items && <td className="whitespace-nowrap px-2 py-1.5 text-right">{found.length ? `${found.length} folders · ${fmtBytes(found.reduce((s, i) => s + i.disk_bytes, 0))}` : "nothing found yet"}</td>}
                      </tr>
                    );
                  })}
                  {!loc.scan_roots.length && <tr><td className="px-2 py-2 text-amber-600">No folders set.</td></tr>}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Skipped folder names: {loc.exclude_names.length ? loc.exclude_names.join(", ") : "none"}. Protected (never deletable): {loc.protected_paths.length ? loc.protected_paths.join(", ") : "none"}.</p>
              <button className="btn mt-2" onClick={() => { props.onClose(); props.onOpenSettings(); }}>Change in Settings</button>
            </section>

            <section>
              <h3 className="mb-1 font-semibold">2. Tool caches and SDKs (Global caches tab)</h3>
              <p className="mb-2 text-slate-500">
                Fixed locations of package managers, IDEs and SDKs for your operating system, such as <code>%LOCALAPPDATA%</code> (AppData) on Windows.
                {" "}The Android SDK is found from <code>ANDROID_SDK_ROOT</code> / <code>ANDROID_HOME</code>
                {loc.android_sdk_env ? <> (currently set to <code>{loc.android_sdk_env}</code>)</> : <> (not set, so the default location is used)</>}.
              </p>
              {[...byCategory.entries()].map(([cat, list]) => (
                <div key={cat} className="mb-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">{cat}</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {list.map((g) => (
                        <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="whitespace-nowrap px-2 py-1">{g.name}</td>
                          <td className="break-all px-2 py-1 font-mono text-slate-500">{g.path}</td>
                          <td className="px-2 py-1 text-right"><Badge ok={g.exists} yes="found" no="not installed" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          </div>
        )}
        <div className="mt-3 flex justify-end"><button className="btn btn-primary" onClick={props.onClose}>Close</button></div>
      </div>
    </div>
  );
}
