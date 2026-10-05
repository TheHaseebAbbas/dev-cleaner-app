import { invoke } from "@tauri-apps/api/core";

export type Risk = "safe" | "caution" | "danger" | "critical" | "blocked";
export type DeleteMode = "trash" | "permanent";
export type Category =
  | "build_artifact" | "project_dependency" | "package_cache" | "tool_cache" | "sdk" | "toolchain"
  | "ide_cache" | "tooling_state" | "project_configuration" | "virtual_environment" | "device_data"
  | "archive" | "temp_data" | "system_data" | "unknown";
export type Cost = "none" | "low" | "medium" | "high" | "very_high" | "unknown";
export type Confidence = "unknown" | "low" | "medium" | "high" | "very_high";
export type GitStatus = "ignored" | "tracked" | "modified" | "untracked" | "unknown" | "not_repository";
export type Verdict = "recommended" | "review" | "keep" | "blocked";
export type BlockSource = "user" | "system" | "git" | "sensitive" | "rule";
export type ActivityMode = "fast" | "accurate";
export type CleanupProfile = "safe" | "recommended" | "deep";

export type Level = "caution" | "danger";
export interface Warning {
  level: Level;
  message: string;
}

export interface Block {
  source: BlockSource;
  reason: string;
}

export interface Reason {
  ok: boolean;
  text: string;
}

export interface Recommendation {
  verdict: Verdict;
  score: number;
  reasons: Reason[];
}

export type Usage =
  | { status: "used"; by: string[] }
  | { status: "unused"; projects_checked: number }
  | { status: "unknown" };

export interface Part {
  id: string;
  path: string;
  name: string;
  disk_bytes: number;
  apparent_bytes: number;
  reclaimable_bytes: number;
  file_count: number;
  last_modified: number;
  warning?: Warning | null;
  block?: Block | null;
  risk?: Risk | null;
  usage?: Usage | null;
  recommendation?: Recommendation | null;
  is_file: boolean;
}

export interface Item {
  id: string;
  scan_id: string;
  path: string;
  rule_id: string;
  rule_version: number;
  rule_name: string;
  ecosystem: string;
  category: Category;
  project_path: string;
  project_name: string;
  package_path: string;
  disk_bytes: number;
  apparent_bytes: number;
  reclaimable_bytes: number;
  file_count: number;
  dir_count: number;
  last_modified: number;
  project_last_modified: number;
  regenerates_with: string;
  description: string;
  consequence: string;
  parts: Part[];
  risk: Risk;
  confidence: Confidence;
  detection: Reason[];
  rebuild_cost: Cost;
  network_cost: Cost;
  download_bytes: number;
  git: GitStatus;
  warnings: Warning[];
  block: Block | null;
  recommendation: Recommendation;
}

export interface Rule {
  id: string;
  version?: number;
  name: string;
  ecosystem: string;
  category?: Category;
  dir_names: string[];
  parent_markers: string[];
  self_markers: string[];
  confidence_markers?: string[];
  base_confidence?: Confidence;
  regenerates_with: string;
  description: string;
  consequence?: string;
  split: boolean;
  risk: Risk;
  rebuild_cost?: Cost;
  network_cost?: Cost;
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
  trash_retention_days: number;
  recommendations_enabled: boolean;
  protect_git_tracked: boolean;
  detect_sensitive_files: boolean;
  minimum_recommendation_confidence: Confidence;
  default_cleanup_profile: CleanupProfile;
  activity_mode: ActivityMode;
  stale_scan_minutes: number;
  require_rescan_before_cleanup: boolean;
  allow_danger_custom_rules: boolean;
}

export interface GlobalCache {
  id: string;
  scan_id: string;
  name: string;
  ecosystem: string;
  category: Category;
  group: string;
  path: string;
  exists: boolean;
  disk_bytes: number;
  apparent_bytes: number;
  reclaimable_bytes: number;
  file_count: number;
  last_modified: number;
  note: string;
  consequence: string;
  regenerates_with: string;
  parts: Part[];
  parts_only: boolean;
  info_only: boolean;
  warnings: Warning[];
  risk: Risk;
  rebuild_cost: Cost;
  network_cost: Cost;
  download_bytes: number;
  block: Block | null;
  recommendation: Recommendation;
  references_checked: boolean;
}

export interface Location {
  id: string;
  name: string;
  ecosystem: string;
  group: string;
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

export type OutcomeKind = "removed" | "blocked" | "skipped" | "failed";

export interface DeleteOutcome {
  id: string;
  path: string;
  ok: boolean;
  result: OutcomeKind;
  code: string | null;
  size_before: number;
  estimated_bytes: number;
  error: string | null;
  raw_error: string | null;
  dry_run: boolean;
  rule_id: string;
  risk: Risk | null;
}

export interface DeleteReport {
  outcomes: DeleteOutcome[];
  removed: number;
  failed: number;
  blocked: number;
  skipped: number;
  estimated_bytes: number;
  volume_free_before: number | null;
  volume_free_after: number | null;
  dry_run: boolean;
  mode: DeleteMode | null;
}

export interface Preview {
  selected: number;
  ready: number;
  blocked: number;
  changed: number;
  size_bytes: number;
  estimated_bytes: number;
  download_bytes: number;
  projects: number;
  with_warnings: number;
  needs_ack: boolean;
  critical: boolean;
  recommended: number;
  review: number;
  keep: number;
  in_use: number;
  scan_age_secs: number;
  volume_free: number | null;
  problems: DeleteOutcome[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  scan_id: string;
  path: string;
  project_root: string;
  rule_id: string;
  category: Category | null;
  risk: Risk | null;
  size_before: number;
  estimated_reclaimed: number;
  mode: DeleteMode;
  result: OutcomeKind;
}

export type ScanProgress =
  | { phase: "discover"; visited: number; found: number; current: string }
  | { phase: "measure"; done: number; total: number; current: string };

export interface SkipStat {
  reason: string;
  count: number;
  examples: string[];
}

export interface ScanSummary {
  scan_id: string;
  started_at: number;
  completed_at: number;
  complete: boolean;
  cancelled: boolean;
  roots: string[];
  dirs_visited: number;
  files_visited: number;
  found: number;
  elapsed_ms: number;
  discovery_ms: number;
  measure_ms: number;
  bytes_examined: number;
  measure_errors: number;
  skipped: SkipStat[];
  rules_active: number;
  rules_version: number;
  settings_hash: string;
  missing_roots: string[];
}

export interface GlobalProgress {
  done: number;
  total: number;
  current: string;
}

export interface ScanRecord {
  scan_id: string;
  kind: string;
  timestamp: number;
  item_count: number;
  total_bytes: number;
  reclaimable_bytes: number;
  duration_ms: number;
  complete: boolean;
}

export interface Diagnostics {
  project_scan: ScanSummary | null;
  global_scan: ScanSummary | null;
  rules_total: number;
  rules_enabled: number;
  rules_disabled: string[];
  custom_rules: number;
  rules_version: number;
  scan_roots: string[];
  exclude_names: string[];
  protected_paths: string[];
  recent_scans: ScanRecord[];
  recent_operations: { timestamp: number; report: DeleteReport }[];
  data_folder: string;
}

export interface TrashEntry {
  id: string;
  name: string;
  original_path: string;
  deleted_at: number;
  bytes: number;
  expires_at: number | null;
}

export interface TrashOutcome {
  id: string;
  path: string;
  ok: boolean;
  error: string | null;
  bytes: number;
}

export interface TrashInfo {
  supported: boolean;
  location: string;
  retention_days: number;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  listRules: () => invoke<Rule[]>("list_rules"),
  startScan: () => invoke<void>("start_scan", { roots: null }),
  cancelScan: () => invoke<void>("cancel_scan"),
  getItems: () => invoke<Item[]>("get_items"),
  previewCleanup: (scanId: string, ids: string[]) => invoke<Preview>("preview_cleanup", { scanId, ids }),
  deleteItems: (scanId: string, ids: string[], acknowledged: boolean) =>
    invoke<DeleteReport>("delete_items", { scanId, ids, acknowledged }),
  startGlobalScan: () => invoke<void>("start_global_scan"),
  cancelGlobalScan: () => invoke<void>("cancel_global_scan"),
  getGlobals: () => invoke<GlobalCache[]>("get_globals"),
  previewGlobalCleanup: (scanId: string, ids: string[], partIds: string[]) =>
    invoke<Preview>("preview_global_cleanup", { scanId, ids, partIds }),
  deleteGlobalCaches: (scanId: string, ids: string[], partIds: string[], acknowledged: boolean) =>
    invoke<DeleteReport>("delete_global_caches", { scanId, ids, partIds, acknowledged }),
  getLocations: () => invoke<Locations>("get_locations"),
  getDiagnostics: () => invoke<Diagnostics>("get_diagnostics"),
  trashInfo: () => invoke<TrashInfo>("trash_info"),
  trashList: () => invoke<TrashEntry[]>("trash_list"),
  trashRestore: (ids: string[]) => invoke<TrashOutcome[]>("trash_restore", { ids }),
  trashPurge: (ids: string[]) => invoke<TrashOutcome[]>("trash_purge", { ids }),
  trashClearExpired: () => invoke<TrashOutcome[]>("trash_clear_expired"),
  openTrash: () => invoke<void>("open_trash"),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  diskSpace: () => invoke<[number, number] | null>("disk_space"),
};

export const RISK_LABEL: Record<Risk, string> = {
  safe: "Safe",
  caution: "Caution",
  danger: "Danger",
  critical: "Critical",
  blocked: "Blocked",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  recommended: "Recommended",
  review: "Review",
  keep: "Keep",
  blocked: "Blocked",
};

export const COST_LABEL: Record<Cost, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  unknown: "Unknown",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
};

export const GIT_LABEL: Record<GitStatus, string> = {
  ignored: "Ignored by Git",
  tracked: "Tracked by Git",
  modified: "Tracked, with uncommitted changes",
  untracked: "Not tracked",
  unknown: "Git unavailable",
  not_repository: "Not in a repository",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  build_artifact: "Build output",
  project_dependency: "Project dependencies",
  package_cache: "Package cache",
  tool_cache: "Tool cache",
  sdk: "SDK",
  toolchain: "Toolchain",
  ide_cache: "IDE cache",
  tooling_state: "Tool state",
  project_configuration: "Project configuration",
  virtual_environment: "Virtual environment",
  device_data: "Device data",
  archive: "Archive",
  temp_data: "Temporary data",
  system_data: "System data",
  unknown: "Unknown",
};

/** A report for a request that failed before the backend could check anything. */
export function failedReport(error: string): DeleteReport {
  return {
    outcomes: [{ id: "", path: "(request)", ok: false, result: "failed", code: "UNKNOWN", size_before: 0, estimated_bytes: 0, error, raw_error: null, dry_run: false, rule_id: "", risk: null }],
    removed: 0, failed: 1, blocked: 0, skipped: 0, estimated_bytes: 0, volume_free_before: null, volume_free_after: null, dry_run: false, mode: null,
  };
}

/** A part's own risk where it has one, else its owner's. */
export function partRisk(p: Part, owner: Risk): Risk {
  return p.block ? "blocked" : p.risk ?? owner;
}

/** Ids selected by a quick-select profile. Never includes blocked items. */
export function profileMatches(i: Item, profile: CleanupProfile): boolean {
  if (i.block) return false;
  const v = i.recommendation.verdict;
  if (profile === "safe") return i.risk === "safe" && v === "recommended";
  if (profile === "recommended") return v === "recommended";
  return v === "recommended" || v === "review";
}

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

/** "in 3 days", "tomorrow", "today" for a future unix time. */
export function fmtUntil(secs: number): string {
  const d = Math.ceil((secs - Date.now() / 1000) / 86400);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}
