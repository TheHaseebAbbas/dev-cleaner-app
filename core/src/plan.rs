//! Turns a cleanup request (scan id + item/part ids) into revalidated targets, a preview, and a
//! report. Requests are tied to one scan: ids from an older, cancelled or unknown scan are refused.

use crate::cleaner::{self, DeleteOutcome, DeleteReport, ErrorCode, Target};
use crate::global::{self, GlobalCache};
use crate::model::{Level, Risk, Usage, Verdict, Warning};
use crate::scanner::{now_secs, Item, ScanSummary};
use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;

fn needs_ack(risk: Risk, warnings: &[Warning]) -> bool {
    risk >= Risk::Danger || warnings.iter().any(|w| w.level == Level::Danger)
}

/// What the preview and report need besides the target itself.
#[derive(Debug, Clone, Default)]
pub struct Planned {
    pub target: Target,
    pub size: u64,
    pub reclaimable: u64,
    pub download: u64,
    pub verdict: Option<Verdict>,
    pub warnings: usize,
    pub in_use: bool,
}

fn session_check(summary: Option<&ScanSummary>, scan_id: &str) -> Result<(), (ErrorCode, &'static str)> {
    match summary {
        None => Err((ErrorCode::ScanOutdated, "There is no finished scan. Scan again before cleaning.")),
        Some(s) if s.scan_id != scan_id => Err((ErrorCode::ScanOutdated, "This list is from an older scan. Scan again before cleaning.")),
        Some(s) if !s.complete => Err((ErrorCode::ScanIncomplete, "The scan was stopped before it finished. Run a complete scan before cleaning.")),
        _ => Ok(()),
    }
}

/// Resolve project-scan ids (items or their parts). A part whose folder is also requested is dropped.
pub fn resolve_items(items: &[Item], summary: Option<&ScanSummary>, scan_id: &str, ids: &[String], dry_run: bool) -> Vec<Result<Planned, DeleteOutcome>> {
    if let Err((code, why)) = session_check(summary, scan_id) {
        return ids.iter().map(|id| Err(DeleteOutcome::unknown(id, code, why, dry_run))).collect();
    }
    let wanted: BTreeSet<&str> = ids.iter().map(String::as_str).collect();
    let mut out = vec![];
    for id in ids {
        if let Some(i) = items.iter().find(|i| &i.id == id) {
            out.push(Ok(Planned {
                target: Target {
                    id: i.id.clone(),
                    path: PathBuf::from(&i.path),
                    fingerprint: Some(i.fingerprint.clone()),
                    scan_id: i.scan_id.clone(),
                    rule_id: i.rule_id.clone(),
                    rule_version: i.rule_version,
                    category: Some(i.category),
                    risk: i.risk,
                    project_path: i.project_path.clone(),
                    needs_ack: needs_ack(i.risk, &i.warnings),
                    block: i.block.clone(),
                    allow_file: false,
                    ..Default::default()
                },
                size: i.disk_bytes,
                reclaimable: i.reclaimable_bytes,
                download: i.download_bytes,
                verdict: Some(i.recommendation.verdict),
                warnings: i.warnings.len(),
                in_use: false,
            }));
        } else if let Some((i, p)) = items.iter().find_map(|i| i.parts.iter().find(|p| &p.id == id).map(|p| (i, p))) {
            if wanted.contains(i.id.as_str()) {
                continue;
            }
            let risk = p.risk.unwrap_or(i.risk);
            out.push(Ok(Planned {
                target: Target {
                    id: p.id.clone(),
                    path: PathBuf::from(&p.path),
                    fingerprint: Some(p.fingerprint.clone()),
                    scan_id: i.scan_id.clone(),
                    rule_id: i.rule_id.clone(),
                    rule_version: i.rule_version,
                    category: Some(i.category),
                    risk,
                    project_path: i.project_path.clone(),
                    needs_ack: needs_ack(risk, &i.warnings),
                    block: p.block.clone().or_else(|| i.block.clone()),
                    allow_file: p.is_file,
                    ..Default::default()
                },
                size: p.disk_bytes,
                reclaimable: p.reclaimable_bytes,
                download: (p.disk_bytes as f64 * i.category.download_factor()) as u64 * u64::from(i.download_bytes > 0),
                verdict: Some(i.recommendation.verdict),
                warnings: i.warnings.len(),
                in_use: false,
            }));
        } else {
            out.push(Err(DeleteOutcome::unknown(id, ErrorCode::TargetNotInScan, "Not part of the last scan.", dry_run)));
        }
    }
    out
}

/// Resolve global ids: `ids` are whole locations, `part_ids` single parts.
pub fn resolve_globals(caches: &[GlobalCache], summary: Option<&ScanSummary>, scan_id: &str, ids: &[String], part_ids: &[String], dry_run: bool) -> Vec<Result<Planned, DeleteOutcome>> {
    let all: Vec<&String> = ids.iter().chain(part_ids).collect();
    if let Err((code, why)) = session_check(summary, scan_id) {
        return all.iter().map(|id| Err(DeleteOutcome::unknown(id, code, why, dry_run))).collect();
    }
    let mut out = vec![];
    for id in ids {
        let Some(c) = caches.iter().find(|c| &c.id == id && c.exists) else {
            out.push(Err(DeleteOutcome::unknown(id, ErrorCode::TargetNotInScan, "Unknown or missing location.", dry_run)));
            continue;
        };
        let target = Target {
            id: c.id.clone(),
            path: PathBuf::from(&c.path),
            fingerprint: Some(c.fingerprint.clone()),
            scan_id: c.scan_id.clone(),
            rule_id: c.id.clone(),
            rule_version: crate::rules::RULES_VERSION,
            category: Some(c.category),
            risk: c.risk,
            project_path: String::new(),
            needs_ack: needs_ack(c.risk, &c.warnings) || c.parts.iter().any(|p| p.warning.as_ref().is_some_and(|w| w.level == Level::Danger)),
            block: c.block.clone(),
            allow_file: false,
            ..Default::default()
        };
        if c.info_only {
            out.push(Err(DeleteOutcome::refused(&target, ErrorCode::ViewOnly, "View only: this cannot be removed from here.", dry_run)));
        } else if c.parts_only {
            out.push(Err(DeleteOutcome::refused(&target, ErrorCode::PartsOnly, "This location can only be cleaned part by part.", dry_run)));
        } else if let Some(p) = c.parts.iter().find(|p| p.block.is_some()) {
            out.push(Err(DeleteOutcome::refused(&target, ErrorCode::TargetBlocked, format!("{} inside it must be kept: {}", p.name, p.block.as_ref().map(|b| b.reason.as_str()).unwrap_or("")), dry_run)));
        } else {
            out.push(Ok(Planned { target, size: c.disk_bytes, reclaimable: c.reclaimable_bytes, download: c.download_bytes, verdict: Some(c.recommendation.verdict), warnings: c.warnings.len(), in_use: c.parts.iter().any(|p| matches!(p.usage, Some(Usage::Used { .. }))) }));
        }
    }
    for pid in part_ids {
        let Some((c, p)) = caches.iter().find_map(|c| c.parts.iter().find(|p| &p.id == pid).map(|p| (c, p))) else {
            out.push(Err(DeleteOutcome::unknown(pid, ErrorCode::TargetNotInScan, "Not a known part.", dry_run)));
            continue;
        };
        if ids.contains(&c.id) {
            continue;
        }
        let risk = p.risk.unwrap_or(c.risk);
        let warnings: Vec<Warning> = c.warnings.iter().cloned().chain(p.warning.clone()).collect();
        let path = PathBuf::from(&p.path);
        let target = Target {
            id: p.id.clone(),
            companions: global::companions(&c.id, &path),
            path,
            fingerprint: Some(p.fingerprint.clone()),
            scan_id: c.scan_id.clone(),
            rule_id: c.id.clone(),
            rule_version: crate::rules::RULES_VERSION,
            category: Some(c.category),
            risk,
            project_path: String::new(),
            needs_ack: needs_ack(risk, &warnings),
            block: p.block.clone().or_else(|| c.block.clone()),
            allow_file: p.is_file,
            ..Default::default()
        };
        if c.info_only {
            out.push(Err(DeleteOutcome::refused(&target, ErrorCode::ViewOnly, "View only: this cannot be removed from here.", dry_run)));
            continue;
        }
        out.push(Ok(Planned {
            target,
            size: p.disk_bytes,
            reclaimable: p.reclaimable_bytes,
            download: (p.disk_bytes as f64 * c.category.download_factor()) as u64 * u64::from(c.download_bytes > 0),
            verdict: p.recommendation.as_ref().map(|r| r.verdict),
            warnings: warnings.len(),
            in_use: matches!(p.usage, Some(Usage::Used { .. })),
        }));
    }
    out
}

/// Checks that depend on the moment of cleaning rather than on the scan: programs using a
/// target right now (one process snapshot for the whole run) and custom rules that have never
/// cleaned before. Both make the target need explicit confirmation.
pub fn annotate(planned: &mut [Result<Planned, DeleteOutcome>], detect_in_use: bool, unconfirmed_rules: &[String]) {
    let snap = if detect_in_use { crate::inuse::Snapshot::take() } else { None };
    for p in planned.iter_mut().flatten() {
        if let Some(s) = &snap {
            let mut u = s.check(&p.target.path, &p.target.rule_id);
            if p.target.rule_id == "temp-win" {
                u = crate::inuse::with_locks(u, crate::inuse::locked_files(&p.target.path, 200));
            }
            if u.in_use() {
                p.target.in_use = Some(u.describe());
            }
        }
        if unconfirmed_rules.contains(&p.target.rule_id) {
            p.target.first_use_rule = true;
        }
    }
}

/// What a cleanup would do, checked against the disk right now. Nothing is touched.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Preview {
    pub selected: usize,
    /// Pass every check now.
    pub ready: usize,
    pub blocked: usize,
    /// Changed or missing since the scan.
    pub changed: usize,
    pub size_bytes: u64,
    pub estimated_bytes: u64,
    pub download_bytes: u64,
    pub projects: usize,
    pub with_warnings: usize,
    pub needs_ack: bool,
    pub critical: bool,
    pub recommended: usize,
    pub review: usize,
    pub keep: usize,
    /// Selected things a scanned project still uses.
    pub in_use: usize,
    /// Selected things a running program uses right now.
    #[serde(default)]
    pub running: usize,
    /// Custom rules (ids) used to clean for the first time.
    #[serde(default)]
    pub first_use_rules: Vec<String>,
    pub scan_age_secs: u64,
    pub volume_free: Option<u64>,
    /// Per-target problems found now (only refusals are listed).
    pub problems: Vec<DeleteOutcome>,
}

pub fn preview(planned: &[Result<Planned, DeleteOutcome>], summary: Option<&ScanSummary>, protected: &[PathBuf]) -> Preview {
    let mut p = Preview { selected: planned.len(), ..Default::default() };
    let mut projects = BTreeSet::new();
    for r in planned {
        match r {
            Err(o) => {
                if o.result == cleaner::OutcomeKind::Blocked { p.blocked += 1 } else { p.changed += 1 }
                p.problems.push(o.clone());
            }
            Ok(pl) => {
                match pl.verdict {
                    Some(Verdict::Recommended) => p.recommended += 1,
                    Some(Verdict::Keep) | Some(Verdict::Blocked) => p.keep += 1,
                    _ => p.review += 1,
                }
                if pl.in_use {
                    p.in_use += 1;
                }
                if pl.target.in_use.is_some() {
                    p.running += 1;
                    p.needs_ack = true;
                }
                if pl.target.first_use_rule && !p.first_use_rules.contains(&pl.target.rule_id) {
                    p.first_use_rules.push(pl.target.rule_id.clone());
                    p.needs_ack = true;
                }
                match cleaner::validate(&pl.target, true, protected) {
                    Ok(()) => {
                        p.ready += 1;
                        p.size_bytes += pl.size;
                        p.estimated_bytes += pl.reclaimable;
                        p.download_bytes += pl.download;
                        if pl.warnings > 0 {
                            p.with_warnings += 1;
                        }
                        p.needs_ack |= pl.target.needs_ack;
                        p.critical |= pl.target.risk >= Risk::Critical;
                        if !pl.target.project_path.is_empty() {
                            projects.insert(pl.target.project_path.clone());
                        }
                    }
                    Err((code, why)) => {
                        let o = DeleteOutcome::refused(&pl.target, code, why, true);
                        if o.result == cleaner::OutcomeKind::Blocked { p.blocked += 1 } else { p.changed += 1 }
                        p.problems.push(o);
                    }
                }
            }
        }
    }
    p.projects = projects.len();
    p.scan_age_secs = summary.map(|s| now_secs().saturating_sub(s.completed_at)).unwrap_or(0);
    p.volume_free = dirs::home_dir().and_then(|h| cleaner::volume_free(&h));
    p
}

/// Run the plan and build the report. `before`/`after` free space is measured on the volume of
/// the first target (permanent deletes only).
pub fn run(planned: Vec<Result<Planned, DeleteOutcome>>, mode: DeleteMode, dry_run: bool, acknowledged: bool, protected: &[PathBuf]) -> DeleteReport {
    let probe = planned.iter().find_map(|r| r.as_ref().ok()).map(|p| p.target.path.clone());
    let free = |p: &Option<PathBuf>| p.as_ref().and_then(|x| cleaner::volume_free(x));
    let measure = mode == DeleteMode::Permanent && !dry_run;
    let before = if measure { free(&probe) } else { None };
    let outcomes: Vec<DeleteOutcome> = planned
        .into_iter()
        .map(|r| match r {
            Err(o) => o,
            Ok(p) => cleaner::execute(&p.target, mode, dry_run, acknowledged, protected),
        })
        .collect();
    let after = if measure { free(&probe) } else { None };
    DeleteReport::new(outcomes, mode, dry_run, before, after)
}
