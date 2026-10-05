import { useEffect, useState } from "react";
import { api, fmtBytes, type DependencyGraph, type VersionNode } from "../api";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/primitives";

/**
 * Which scanned projects use which installed SDK, toolchain and Gradle versions. Versions nothing
 * uses can be selected from here; versions projects ask for that are not installed are listed so
 * removing a neighbour does not come as a surprise.
 */
export function DependencyMap(props: { refreshKey: string; selected: Set<string>; onSelectParts: (ids: string[]) => void; onFocus: (locationId: string) => void }) {
  const [g, setG] = useState<DependencyGraph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.getDependencyGraph().then(setG, (e) => setErr(String(e))); }, [props.refreshKey]);
  if (err) return <p className="p-5 text-[13px] text-red-600 dark:text-red-400">{err}</p>;
  if (!g) return <div className="flex justify-center p-8"><Spinner className="h-5 w-5" /></div>;
  if (!g.groups.length) {
    return (
      <div className="p-6 text-[13px]">
        <div className="font-medium">No versioned SDKs or toolchains found</div>
        <p className="muted mt-1">The map covers Rust toolchains, Android platforms, build-tools and NDKs, Flutter versions managed by FVM, and Gradle wrapper distributions.</p>
      </div>
    );
  }
  const unused = (v: VersionNode) => v.installed && !v.projects.length && !v.kept;
  return (
    <div>
      {!g.has_projects && (
        <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[13px] text-amber-800 divider dark:text-amber-300">
          <Icon name="info" className="h-4 w-4" />Scan your projects first. Until then, Dev Cleaner cannot tell which versions they use.
        </div>
      )}
      {g.has_projects && (
        <div className="muted border-b px-4 py-2.5 text-[13px] divider">
          Checked against {g.projects_checked} scanned project{g.projects_checked === 1 ? "" : "s"}.{g.unused_bytes > 0 && <> About <b className="text-slate-900 dark:text-slate-100">{fmtBytes(g.unused_bytes)}</b> is in versions none of them use.</>}
        </div>
      )}
      {g.groups.map((grp) => {
        const free = grp.versions.filter((v) => unused(v) && g.has_projects && !grp.unpinned.length);
        return (
          <section key={grp.id} className="border-b last:border-0 divider">
            <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 dark:bg-slate-800/50">
              <button className="min-w-0 flex-1 text-left" onClick={() => props.onFocus(grp.id)}>
                <div className="truncate text-[14px] font-semibold">{grp.name}</div>
                <div className="muted truncate text-xs">{grp.ecosystem}{grp.unpinned.length ? ` · ${grp.unpinned.length} project${grp.unpinned.length === 1 ? " does" : "s do"} not pin a version, so unused versions are not suggested` : ""}</div>
              </button>
              {free.length > 0 && <button className="btn btn-sm" onClick={() => props.onSelectParts(free.map((v) => v.id))}>Select {free.length} unused</button>}
            </div>
            <ul>
              {grp.versions.map((v) => (
                <li key={v.id} className={`flex items-center gap-3 border-t px-4 py-1.5 text-[13px] divider ${props.selected.has(v.id) ? "bg-indigo-50/60 dark:bg-indigo-500/10" : ""}`}>
                  <span className="mono w-44 shrink-0 truncate" title={v.label}>{v.label}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {!v.installed ? (
                      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><Icon name="alert" className="h-3.5 w-3.5" />Not installed · needed by {v.projects.join(", ")}</span>
                    ) : v.projects.length ? (
                      v.projects.slice(0, 6).map((p) => <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{p}</span>)
                    ) : v.kept ? (
                      <span className="muted flex items-center gap-1 text-xs" title={v.kept}><Icon name="lock" className="h-3.5 w-3.5" />Kept</span>
                    ) : (
                      <span className="muted flex items-center gap-1 text-xs"><Icon name="check" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />{g.has_projects ? "Not used by scanned projects" : "Usage unknown"}</span>
                    )}
                    {v.projects.length > 6 && <span className="muted text-xs">and {v.projects.length - 6} more</span>}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums">{v.installed ? fmtBytes(v.bytes) : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
