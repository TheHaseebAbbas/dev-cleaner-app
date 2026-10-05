import type { Rule, Settings } from "../api";

/** Plain-language explanation of where Dev Cleaner looks and what it removes. */
export function HowItWorks(props: { settings: Settings; rules: Rule[]; onOpenSettings: () => void; onClose?: () => void }) {
  const active = props.rules.filter((r) => r.enabled);
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="mb-1 font-semibold">1. Where it looks</h3>
        <p className="text-slate-600 dark:text-slate-300">Only inside the folders you choose. It walks them up to {props.settings.max_depth} levels deep and skips folders named {props.settings.exclude_names.map((n) => `“${n}”`).join(", ") || "(none)"}.</p>
        <ul className="mt-1 list-disc pl-5">
          {props.settings.scan_roots.length ? props.settings.scan_roots.map((r) => <li key={r} className="break-all font-mono text-xs">{r}</li>) : <li className="text-amber-600">No folders set yet. Add some in Settings.</li>}
        </ul>
        <button className="btn mt-2" onClick={() => { props.onClose?.(); props.onOpenSettings(); }}>Change scan folders</button>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">2. What it picks</h3>
        <p className="text-slate-600 dark:text-slate-300">Only folders that match one of the {active.length} active rules. A rule needs a project file next to the folder (for example <code>node_modules</code> only counts if <code>package.json</code> is beside it), so unrelated folders with the same name are ignored. Your source code is never selected.</p>
        <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <tbody>
              {active.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{r.dir_names.join(" / ")}</td>
                  <td className="px-2 py-1 text-slate-500">{r.parent_markers.length ? `needs ${r.parent_markers.join(" or ")}` : r.self_markers.length ? `contains ${r.self_markers.join(" or ")}` : "any"}</td>
                  <td className="px-2 py-1">{r.description}{r.split ? " (can be removed in parts)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">3. What happens when you clean</h3>
        <p className="text-slate-600 dark:text-slate-300">Only the folders you tick are removed (shown with their full path before anything happens). {props.settings.delete_mode === "trash" ? "They go to the Trash / Recycle Bin, so you can put them back." : "They are deleted permanently."} Each folder comes back by running its restore command (such as <code>npm install</code>). Tick a single part (like <code>target/debug</code>) to remove only that part.</p>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">4. Safety</h3>
        <ul className="list-disc pl-5 text-slate-600 dark:text-slate-300">
          <li>Dry run shows what would happen without deleting.</li>
          <li>Protected paths are listed but cannot be selected.</li>
          <li>It refuses your home folder, drive roots, symlinks, and anything that was not found by the last scan.</li>
          <li>“not git-ignored” warns when a folder might be tracked by git.</li>
        </ul>
      </section>
    </div>
  );
}
