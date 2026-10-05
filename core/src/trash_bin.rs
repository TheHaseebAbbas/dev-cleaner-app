//! Management of items Dev Cleaner moved to the operating system's Trash:
//! list them, put them back, delete them for good, and clear old ones automatically.
//!
//! Only items that match an entry in Dev Cleaner's own history are ever shown or touched,
//! so the rest of the user's Trash is left alone. The OS Trash cannot be enumerated on macOS,
//! so there `supported()` is false.

use crate::history::HistoryEntry;
use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashEntry {
    /// Opaque id, valid while the item stays in the Trash.
    pub id: String,
    pub name: String,
    pub original_path: String,
    /// Unix seconds when it was moved to the Trash.
    pub deleted_at: u64,
    pub bytes: u64,
    /// Unix seconds when it will be removed automatically; None when auto-clear is off.
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashOutcome {
    pub id: String,
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    pub bytes: u64,
}

pub fn supported() -> bool {
    cfg!(not(target_os = "macos"))
}

/// Where the OS keeps the Trash, for display.
pub fn location_hint() -> &'static str {
    if cfg!(target_os = "windows") {
        "the Recycle Bin"
    } else if cfg!(target_os = "macos") {
        "the Trash (~/.Trash)"
    } else {
        "the Trash (~/.local/share/Trash)"
    }
}

pub fn expires_at(deleted_at: u64, retention_days: u32) -> Option<u64> {
    (retention_days > 0).then(|| deleted_at + retention_days as u64 * 86_400)
}

pub fn is_expired(deleted_at: u64, retention_days: u32, now: u64) -> bool {
    expires_at(deleted_at, retention_days).is_some_and(|t| now >= t)
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// The history entry (moved to Trash) that best matches a trashed item: same path, closest in time.
pub fn match_history<'a>(history: &'a [HistoryEntry], original: &str, deleted_at: u64) -> Option<&'a HistoryEntry> {
    let key = norm(original);
    history
        .iter()
        .filter(|h| h.mode == DeleteMode::Trash && norm(&h.path) == key)
        .min_by_key(|h| h.timestamp.abs_diff(deleted_at))
        .filter(|h| h.timestamp.abs_diff(deleted_at) <= 86_400)
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;
    use trash::os_limited;
    use trash::TrashItem;

    fn mine(history: &[HistoryEntry]) -> Result<Vec<(TrashItem, u64, u64)>, String> {
        let items = os_limited::list().map_err(|e| e.to_string())?;
        Ok(items
            .into_iter()
            .filter_map(|it| {
                let orig = it.original_path().to_string_lossy().into_owned();
                let deleted = it.time_deleted.max(0) as u64;
                let h = match_history(history, &orig, deleted)?;
                let bytes = h.estimated_reclaimed;
                Some((it, deleted, bytes))
            })
            .collect())
    }

    pub fn list(history: &[HistoryEntry], retention_days: u32) -> Result<Vec<TrashEntry>, String> {
        let mut v: Vec<TrashEntry> = mine(history)?
            .into_iter()
            .map(|(it, deleted_at, bytes)| TrashEntry {
                id: it.id.to_string_lossy().into_owned(),
                name: it.name.to_string_lossy().into_owned(),
                original_path: it.original_path().to_string_lossy().into_owned(),
                deleted_at,
                bytes,
                expires_at: expires_at(deleted_at, retention_days),
            })
            .collect();
        v.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        Ok(v)
    }

    fn each(history: &[HistoryEntry], ids: &[String], restore: bool) -> Result<Vec<TrashOutcome>, String> {
        let all = mine(history)?;
        Ok(ids
            .iter()
            .map(|id| match all.iter().find(|(it, _, _)| it.id.to_string_lossy() == id.as_str()) {
                None => TrashOutcome { id: id.clone(), path: String::new(), ok: false, error: Some("no longer in the Trash".into()), bytes: 0 },
                Some((it, _, bytes)) => {
                    let path = it.original_path().to_string_lossy().into_owned();
                    if restore {
                        if let Err(why) = restore_check(&it.original_path()) {
                            return TrashOutcome { id: id.clone(), path, ok: false, error: Some(why), bytes: 0 };
                        }
                    }
                    let res = if restore { os_limited::restore_all([it.clone()]) } else { os_limited::purge_all([it.clone()]) };
                    match res {
                        Ok(()) => TrashOutcome { id: id.clone(), path, ok: true, error: None, bytes: *bytes },
                        Err(e) => TrashOutcome { id: id.clone(), path, ok: false, error: Some(e.to_string()), bytes: 0 },
                    }
                }
            })
            .collect())
    }

    pub fn restore(history: &[HistoryEntry], ids: &[String]) -> Result<Vec<TrashOutcome>, String> { each(history, ids, true) }
    pub fn purge(history: &[HistoryEntry], ids: &[String]) -> Result<Vec<TrashOutcome>, String> { each(history, ids, false) }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    const MSG: &str = "Managing the Trash from the app is not available on macOS";
    pub fn list(_: &[HistoryEntry], _: u32) -> Result<Vec<TrashEntry>, String> { Err(MSG.into()) }
    pub fn restore(_: &[HistoryEntry], _: &[String]) -> Result<Vec<TrashOutcome>, String> { Err(MSG.into()) }
    pub fn purge(_: &[HistoryEntry], _: &[String]) -> Result<Vec<TrashOutcome>, String> { Err(MSG.into()) }
}

/// Before putting something back: the original place must be free, its parent must still exist,
/// be a real folder (not a link or junction that now points elsewhere) and be writable.
pub fn restore_check(original: &std::path::Path) -> Result<(), String> {
    if std::fs::symlink_metadata(original).is_ok() {
        return Err("Something already exists at the original location; it is not overwritten.".into());
    }
    let parent = original.parent().ok_or("The original location has no parent folder.")?;
    let md = std::fs::symlink_metadata(parent).map_err(|_| "The original parent folder no longer exists.".to_string())?;
    if let Some(kind) = crate::safety::redirection(parent) {
        return Err(format!("The original parent folder is now a {kind}; restoring through it is refused."));
    }
    if !md.is_dir() {
        return Err("The original parent is no longer a folder.".into());
    }
    if md.permissions().readonly() {
        return Err("The original parent folder is read-only.".into());
    }
    Ok(())
}

/// Items Dev Cleaner moved to the Trash, newest first.
pub fn list(history: &[HistoryEntry], retention_days: u32) -> Result<Vec<TrashEntry>, String> {
    imp::list(history, retention_days)
}

/// Put items back where they came from. Fails per item if the original place is taken.
pub fn restore(history: &[HistoryEntry], ids: &[String]) -> Result<Vec<TrashOutcome>, String> {
    imp::restore(history, ids)
}

/// Delete items for good.
pub fn purge(history: &[HistoryEntry], ids: &[String]) -> Result<Vec<TrashOutcome>, String> {
    imp::purge(history, ids)
}

/// Delete every item older than the retention period. Returns what was removed.
pub fn purge_expired(history: &[HistoryEntry], retention_days: u32, now: u64) -> Result<Vec<TrashOutcome>, String> {
    if retention_days == 0 || !supported() {
        return Ok(vec![]);
    }
    let ids: Vec<String> = list(history, retention_days)?
        .into_iter()
        .filter(|e| is_expired(e.deleted_at, retention_days, now))
        .map(|e| e.id)
        .collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    purge(history, &ids)
}
