import { invoke } from "@tauri-apps/api/core";

export type Risk = "low" | "medium" | "high";
export type DeleteMode = "trash" | "permanent";

export type Level = "caution" | "danger";
export interface Warning {
  level: Level;
  message: string;
}

export interface Part {
  path: string;
  name: string;
  disk_bytes: number;
  apparent_bytes: number;
  file_count: number;
  last_modified: number;
  warning?: Warning | null;
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
  git_tracked: boolean | null;
  warnings: Warning[];
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
  scan_on_launch: boolean;
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
  parts_only: boolean;
  info_only: boolean;
  warnings: Warning[];
}

export interface Location {
  id: string;
  name: string;
  category: string;
  path: string;
  exists: boolean;
}

export interface Locations {
  scan_roots: { path: string; exists: boolean }[];
  exclude_names: string[];
  protected_paths: string[];
  max_depth: number;
  android_sdk_env: string | null;
  global: Location[];
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

export type ScanProgress =
  | { phase: "discover"; visited: number; found: number; current: string }
  | { phase: "measure"; done: number; total: number; current: string };

export interface ScanSummary {
  dirs_visited: number;
  found: number;
  elapsed_ms: number;
  cancelled: boolean;
  missing_roots: string[];
}

export interface GlobalProgress {
  done: number;
  total: number;
  current: string;
}

export interface GlobalSummary {
  cancelled: boolean;
  elapsed_ms: number;
  found: number;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  listRules: () => invoke<Rule[]>("list_rules"),
  startScan: () => invoke<void>("start_scan", { roots: null }),
  cancelScan: () => invoke<void>("cancel_scan"),
  deleteItems: (paths: string[]) => invoke<DeleteOutcome[]>("delete_items", { paths }),
  startGlobalScan: () => invoke<void>("start_global_scan"),
  cancelGlobalScan: () => invoke<void>("cancel_global_scan"),
  getLocations: () => invoke<Locations>("get_locations"),
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

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, ms > 0 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtAge(secs: number): string {
  if (!secs) return "unknown";
  const d = ageDays(secs);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 31) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}
