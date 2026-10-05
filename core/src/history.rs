//! Append-only logs (JSON lines):
//! - `history.jsonl`: everything that was removed (the History screen and Trash matching),
//! - `operations.jsonl`: every cleanup attempt, including refusals and failures (diagnostics),
//! - `scans.jsonl`: a short summary of each scan.

use crate::cleaner::{DeleteOutcome, DeleteReport, OutcomeKind};
use crate::model::{Category, Risk};
use crate::scanner::ScanSummary;
use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(default)]
    pub id: String,
    pub timestamp: u64,
    #[serde(default)]
    pub scan_id: String,
    #[serde(default)]
    pub item_id: String,
    pub path: String,
    #[serde(default)]
    pub project_root: String,
    #[serde(default)]
    pub rule_id: String,
    #[serde(default)]
    pub rule_version: u32,
    #[serde(default)]
    pub category: Option<Category>,
    #[serde(default)]
    pub risk: Option<Risk>,
    #[serde(default)]
    pub size_before: u64,
    /// Estimated space recovered (older entries called this `bytes_freed`).
    #[serde(alias = "bytes_freed")]
    pub estimated_reclaimed: u64,
    pub mode: DeleteMode,
    #[serde(default = "removed")]
    pub result: OutcomeKind,
}

fn removed() -> OutcomeKind {
    OutcomeKind::Removed
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn append<T: Serialize>(file: &Path, rows: impl IntoIterator<Item = T>) -> std::io::Result<()> {
    if let Some(p) = file.parent() {
        fs::create_dir_all(p)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(file)?;
    for r in rows {
        writeln!(f, "{}", serde_json::to_string(&r).map_err(std::io::Error::other)?)?;
    }
    Ok(())
}

pub fn entry(o: &DeleteOutcome, mode: DeleteMode, ts: u64) -> HistoryEntry {
    HistoryEntry {
        id: crate::scanner::id_for(&format!("{ts}:{}", o.path)),
        timestamp: ts,
        scan_id: o.scan_id.clone(),
        item_id: o.id.clone(),
        path: o.path.clone(),
        project_root: o.project_path.clone(),
        rule_id: o.rule_id.clone(),
        rule_version: o.rule_version,
        category: o.category,
        risk: o.risk,
        size_before: o.size_before,
        estimated_reclaimed: o.estimated_bytes,
        mode,
        result: o.result,
    }
}

/// Records successful, real removals for the History screen.
pub fn record(file: &Path, outcomes: &[DeleteOutcome], mode: DeleteMode) -> std::io::Result<()> {
    let ts = now();
    append(file, outcomes.iter().filter(|o| o.ok && !o.dry_run).map(|o| entry(o, mode, ts)))
}

/// One line per cleanup request in the operation log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    pub timestamp: u64,
    pub report: DeleteReport,
}

/// Records every attempt (removed, failed, blocked, skipped, dry runs) for diagnostics.
pub fn record_operation(file: &Path, report: &DeleteReport) -> std::io::Result<()> {
    append(file, [Operation { timestamp: now(), report: report.clone() }])
}

/// Short per-scan record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRecord {
    pub scan_id: String,
    pub kind: String,
    pub timestamp: u64,
    pub item_count: u64,
    pub total_bytes: u64,
    pub reclaimable_bytes: u64,
    pub duration_ms: u64,
    pub complete: bool,
}

pub fn record_scan(file: &Path, kind: &str, s: &ScanSummary, total: u64, reclaimable: u64) -> std::io::Result<()> {
    append(file, [ScanRecord { scan_id: s.scan_id.clone(), kind: kind.into(), timestamp: s.completed_at, item_count: s.found, total_bytes: total, reclaimable_bytes: reclaimable, duration_ms: s.elapsed_ms, complete: s.complete }])
}

pub fn load(file: &Path) -> Vec<HistoryEntry> {
    load_lines(file)
}

pub fn load_lines<T: for<'de> Deserialize<'de>>(file: &Path) -> Vec<T> {
    fs::read_to_string(file).map(|s| s.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()).unwrap_or_default()
}
