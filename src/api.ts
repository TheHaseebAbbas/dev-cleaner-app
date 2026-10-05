import { invoke } from "@tauri-apps/api/core";

export type Risk = "low" | "medium" | "high";
export type DeleteMode = "trash" | "permanent";

export interface Part {
  path: string;
  name: string;
  disk_bytes: number;
  apparent_bytes: number;
  file_count: number;
  last_modified: number;
}

export interface Item {
  path: string;
  rule_id: string;
  rule_name: string;
  ecosystem: string;
  project_path: string;
  project_name: string;
  disk_bytes: number;
  apparent_bytes: number;
  file_count: number;
  dir_count: number;
  last_modified: number;
  project_last_modified: number;
  regenerates_with: string;
  description: string;
  parts: Part[];
  risk: Risk;
  git_ignored: boolean | null;
  protected: boolean;
}

export interface Rule {
  id: string;
  name: string;
  ecosystem: string;
  dir_names: string[];
  parent_markers: string[];
  self_markers: string[];
  regenerates_with: string;
  description: string;
  split: boolean;
  risk: Risk;
  enabled: boolean;
  custom: boolean;
}

export interface Settings {
  scan_roots: string[];
  exclude_names: string[];
  protected_paths: string[];
  rule_enabled: Record<string, boolean>;
  custom_rules: Rule[];
  delete_mode: DeleteMode;
  dry_run: boolean;
  confirm_before_delete: boolean;
  min_size_mb: number;
  min_age_days: number;
  max_depth: number;
  theme: "system" | "light" | "dark";
}

export interface GlobalCache {
  id: string;
  name: string;
  category: string;
  path: string;
  exists: boolean;
  disk_bytes: number;
  file_count: number;
  note: string;
  parts: Part[];
}

export interface DeleteOutcome {
  path: string;
  ok: boolean;
  bytes_freed: number;
  error: string | null;
  dry_run: boolean;
}

export interface HistoryEntry {
  timestamp: number;
  path: string;
  bytes_freed: number;
  mode: DeleteMode;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  listRules: () => invoke<Rule[]>("list_rules"),
  startScan: () => invoke<void>("start_scan", { roots: null }),
  cancelScan: () => invoke<void>("cancel_scan"),
  deleteItems: (paths: string[]) => invoke<DeleteOutcome[]>("delete_items", { paths }),
  listGlobalCaches: () => invoke<GlobalCache[]>("list_global_caches"),
  getItems: () => invoke<Item[]>("get_items"),
  deleteGlobalCaches: (ids: string[], partPaths: string[]) =>
    invoke<DeleteOutcome[]>("delete_global_caches", { ids, partPaths }),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  diskSpace: () => invoke<[number, number] | null>("disk_space"),
};

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function fmtDate(secs: number): string {
  return secs ? new Date(secs * 1000).toLocaleDateString() : "—";
}

export function ageDays(secs: number): number {
  return secs ? Math.floor((Date.now() / 1000 - secs) / 86400) : Infinity;
}
