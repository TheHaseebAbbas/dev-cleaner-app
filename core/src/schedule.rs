//! Scheduled cleanup.
//!
//! Off by default. When on, the app (while it is running) scans the project folders once the
//! interval has passed, then either reminds the user what could be cleaned or moves the
//! matching items to the Trash. It never deletes permanently, never touches anything that needs
//! an acknowledgement, is in use, has a warning or is blocked, and only cleans items whose
//! verdict is Recommended.

use crate::model::{Risk, Verdict};
use crate::scanner::Item;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleAction {
    /// Scan and show what could be cleaned; nothing is removed.
    #[default]
    Remind,
    /// Scan and move the matching items to the Trash.
    Clean,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Schedule {
    pub enabled: bool,
    /// Days between runs (at least 1).
    pub every_days: u32,
    /// "safe" or "recommended". "deep" is not allowed for unattended runs.
    pub profile: String,
    pub action: ScheduleAction,
    /// Remind only once at least this much can be cleaned.
    pub min_bytes: u64,
}

/// The reminder's default threshold: 5 GB.
pub const DEFAULT_MIN_BYTES: u64 = 5 * 1024 * 1024 * 1024;

impl Default for Schedule {
    fn default() -> Self {
        Schedule { enabled: false, every_days: 7, profile: "safe".into(), action: ScheduleAction::Remind, min_bytes: DEFAULT_MIN_BYTES }
    }
}

/// Persistent run state, kept apart from settings so the settings screen never overwrites it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ScheduleState {
    pub last_run: u64,
    pub last_result: Option<RunSummary>,
    /// Paths the last reminder already told the user about.
    pub reminded: BTreeSet<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RunSummary {
    pub timestamp: u64,
    pub action: ScheduleAction,
    /// Items that matched the profile.
    pub matched: usize,
    pub matched_bytes: u64,
    /// Items moved to the Trash (Clean only).
    pub removed: usize,
    pub removed_bytes: u64,
    pub skipped: usize,
    pub dry_run: bool,
    /// Set when the run could not complete (scan stopped, nothing to scan...).
    pub error: Option<String>,
    /// Remind: the user should be told (complete scan, over the threshold, something new).
    pub notify: bool,
}

impl ScheduleState {
    pub fn load(path: &Path) -> ScheduleState {
        std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).map_err(std::io::Error::other)?)
    }
}

/// When the next run is due (unix seconds), or None when the schedule is off.
pub fn next_run(s: &Schedule, last_run: u64) -> Option<u64> {
    s.enabled.then(|| last_run + s.every_days.max(1) as u64 * 86_400)
}

pub fn is_due(s: &Schedule, last_run: u64, now: u64) -> bool {
    next_run(s, last_run).is_some_and(|t| now >= t)
}

/// Whether a reminder run should tell the user, and what to remember for next time.
///
/// It tells only after a complete scan, only when the eligible items add up to at least
/// `min_bytes`, and only when at least one of them was not in an earlier reminder, so the same
/// finding is never repeated. Paths that are gone are forgotten, so a folder that grows back
/// counts as new. A partial scan changes nothing.
pub fn reminder(complete: bool, eligible: &[(String, u64)], min_bytes: u64, reminded: &BTreeSet<String>) -> (bool, BTreeSet<String>) {
    if !complete {
        return (false, reminded.clone());
    }
    let now: BTreeSet<String> = eligible.iter().map(|(p, _)| p.clone()).collect();
    let total: u64 = eligible.iter().map(|(_, b)| b).sum();
    let fresh = now.iter().any(|p| !reminded.contains(p));
    if total >= min_bytes.max(1) && fresh {
        (true, now)
    } else {
        (false, reminded.intersection(&now).cloned().collect())
    }
}

/// Items an unattended run may clean: whole items only, Recommended, no warnings, nothing
/// blocked, not in use, and never Danger or above. "safe" also requires Safe risk.
pub fn eligible(i: &Item, profile: &str) -> bool {
    let base = i.block.is_none()
        && i.warnings.is_empty()
        && i.recommendation.verdict == Verdict::Recommended
        && i.risk <= Risk::Caution
        && !i.in_use.as_ref().is_some_and(|u| u.in_use())
        && !i.parts.iter().any(|p| p.block.is_some());
    match profile {
        "recommended" => base,
        _ => base && i.risk == Risk::Safe,
    }
}
