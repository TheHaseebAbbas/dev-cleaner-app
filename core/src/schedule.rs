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
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule { enabled: false, every_days: 7, profile: "safe".into(), action: ScheduleAction::Remind }
    }
}

/// Persistent run state, kept apart from settings so the settings screen never overwrites it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ScheduleState {
    pub last_run: u64,
    pub last_result: Option<RunSummary>,
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
