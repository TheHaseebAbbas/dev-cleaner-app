//! Append-only cleanup log (JSON lines) used for the history view.

use crate::cleaner::DeleteOutcome;
use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::Path, time::{SystemTime, UNIX_EPOCH}};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub timestamp: u64,
    pub path: String,
    pub bytes_freed: u64,
    pub mode: DeleteMode,
}

pub fn record(file: &Path, outcomes: &[DeleteOutcome], mode: DeleteMode) -> std::io::Result<()> {
    if let Some(p) = file.parent() {
        fs::create_dir_all(p)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(file)?;
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    for o in outcomes.iter().filter(|o| o.ok && !o.dry_run) {
        let e = HistoryEntry { timestamp: ts, path: o.path.clone(), bytes_freed: o.bytes_freed, mode };
        writeln!(f, "{}", serde_json::to_string(&e).map_err(std::io::Error::other)?)?;
    }
    Ok(())
}

pub fn load(file: &Path) -> Vec<HistoryEntry> {
    fs::read_to_string(file)
        .map(|s| s.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
        .unwrap_or_default()
}
