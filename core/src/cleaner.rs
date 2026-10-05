//! Deletion: final revalidation, Trash or permanent removal, and post-delete verification.
//!
//! The UI can recommend; this module decides. Every target is checked again right before it is
//! touched, against what the scan saw and against the current safety rules.

use crate::model::{Block, Category, Fingerprint, Risk};
use crate::safety;
use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};
use std::{fs, io, path::{Path, PathBuf}};

/// Machine-readable reason a target was not (fully) removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    TargetNotInScan,
    ScanIncomplete,
    ScanOutdated,
    TargetProtected,
    TargetSystemPath,
    TargetChanged,
    TargetMissing,
    TargetNotDirectory,
    TargetSymlink,
    TargetJunction,
    TargetBlocked,
    NeedsAcknowledgement,
    ViewOnly,
    PartsOnly,
    PermissionDenied,
    InUse,
    ReadOnlyFilesystem,
    TrashFailed,
    PermanentDeleteFailed,
    PartialCleanup,
    Unknown,
}

/// What happened to one target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutcomeKind {
    /// Removed (or, in a dry run, would be removed).
    Removed,
    /// A safety rule refused it.
    Blocked,
    /// It changed or vanished since the scan; rescan to see it again.
    Skipped,
    /// The operating system refused, or only part of it was removed.
    Failed,
}

impl ErrorCode {
    pub fn kind(self) -> OutcomeKind {
        use ErrorCode::*;
        match self {
            TargetChanged | TargetMissing | ScanOutdated | TargetNotInScan | ScanIncomplete => OutcomeKind::Skipped,
            PermissionDenied | InUse | ReadOnlyFilesystem | TrashFailed | PermanentDeleteFailed | PartialCleanup | Unknown => OutcomeKind::Failed,
            _ => OutcomeKind::Blocked,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteOutcome {
    /// Item or part id from the scan (empty for requests that matched nothing).
    #[serde(default)]
    pub id: String,
    pub path: String,
    pub ok: bool,
    pub result: OutcomeKind,
    pub code: Option<ErrorCode>,
    /// Size on disk measured right before removal.
    pub size_before: u64,
    /// Estimated space recovered (hard links shared with other places excluded). For Trash this
    /// is what emptying the Trash would free.
    pub estimated_bytes: u64,
    /// Plain-language explanation.
    pub error: Option<String>,
    /// The operating system's own message, kept for diagnostics.
    pub raw_error: Option<String>,
    pub dry_run: bool,
    #[serde(default)]
    pub scan_id: String,
    #[serde(default)]
    pub rule_id: String,
    #[serde(default)]
    pub rule_version: u32,
    #[serde(default)]
    pub category: Option<Category>,
    #[serde(default)]
    pub risk: Option<Risk>,
    #[serde(default)]
    pub project_path: String,
}

impl DeleteOutcome {
    pub fn refused(t: &Target, code: ErrorCode, why: impl Into<String>, dry_run: bool) -> DeleteOutcome {
        DeleteOutcome {
            id: t.id.clone(),
            path: t.path.to_string_lossy().into_owned(),
            ok: false,
            result: code.kind(),
            code: Some(code),
            size_before: 0,
            estimated_bytes: 0,
            error: Some(why.into()),
            raw_error: None,
            dry_run,
            scan_id: t.scan_id.clone(),
            rule_id: t.rule_id.clone(),
            rule_version: t.rule_version,
            category: t.category,
            risk: Some(t.risk),
            project_path: t.project_path.clone(),
        }
    }

    /// For a request that does not name anything in the scan.
    pub fn unknown(id: &str, code: ErrorCode, why: impl Into<String>, dry_run: bool) -> DeleteOutcome {
        let t = Target { id: id.into(), path: PathBuf::from(id), ..Default::default() };
        DeleteOutcome::refused(&t, code, why, dry_run)
    }
}

/// One thing to remove, resolved from a scan, with everything needed to revalidate it.
#[derive(Debug, Clone, Default)]
pub struct Target {
    pub id: String,
    pub path: PathBuf,
    pub fingerprint: Option<Fingerprint>,
    pub scan_id: String,
    pub rule_id: String,
    pub rule_version: u32,
    pub category: Option<Category>,
    pub risk: Risk,
    pub project_path: String,
    /// Danger or critical: needs the user's explicit acknowledgement.
    pub needs_ack: bool,
    pub block: Option<Block>,
    /// The target may be a file (e.g. one Claude Code version) rather than a folder.
    pub allow_file: bool,
    /// Removed together with the target when it succeeds (e.g. an emulator's .ini).
    pub companions: Vec<PathBuf>,
}

/// Refuse anything that is not an existing directory, is a filesystem root, home, system or
/// personal folder, a link, junction or mount point, or too shallow to be a cleanup folder.
pub fn check_target(path: &Path) -> Result<(), (ErrorCode, String)> {
    check(path, false)
}

fn check(path: &Path, allow_file: bool) -> Result<(), (ErrorCode, String)> {
    if !path.is_absolute() {
        return Err((ErrorCode::TargetSystemPath, "path must be absolute".into()));
    }
    if safety::lexical(path).components().count() < 3 {
        return Err((ErrorCode::TargetSystemPath, "path too close to filesystem root".into()));
    }
    if let Some(home) = dirs::home_dir() {
        if safety::is_within(&home, path) {
            return Err((ErrorCode::TargetSystemPath, "refusing to delete the home directory or a parent of it".into()));
        }
    }
    let md = fs::symlink_metadata(path).map_err(|e| map_io(&e, "it cannot be read"))?;
    if let Some(kind) = safety::redirection(path) {
        let code = if kind == "symlink" { ErrorCode::TargetSymlink } else { ErrorCode::TargetJunction };
        return Err((code, format!("path is a {kind}")));
    }
    if !md.is_dir() && !(allow_file && md.is_file()) {
        return Err((ErrorCode::TargetNotDirectory, "not a directory".into()));
    }
    if let Some(b) = safety::system_block(path) {
        return Err((ErrorCode::TargetSystemPath, b.reason));
    }
    Ok(())
}

fn map_io(e: &io::Error, what: &str) -> (ErrorCode, String) {
    let raw = e.raw_os_error();
    let busy = if cfg!(windows) { matches!(raw, Some(32) | Some(33)) } else { matches!(raw, Some(16) | Some(26)) };
    let rofs = !cfg!(windows) && raw == Some(30);
    match e.kind() {
        io::ErrorKind::NotFound => (ErrorCode::TargetMissing, "it no longer exists".into()),
        io::ErrorKind::PermissionDenied => (ErrorCode::PermissionDenied, "permission denied".into()),
        _ if busy => (ErrorCode::InUse, "a program is using files inside it".into()),
        _ if rofs => (ErrorCode::ReadOnlyFilesystem, "the drive is read-only".into()),
        _ => (ErrorCode::Unknown, format!("{what}: {e}")),
    }
}

/// Every check that runs right before removal, without touching anything.
pub fn validate(t: &Target, acknowledged: bool, protected: &[PathBuf]) -> Result<(), (ErrorCode, String)> {
    if let Some(b) = &t.block {
        return Err((ErrorCode::TargetBlocked, b.reason.clone()));
    }
    if fs::symlink_metadata(&t.path).is_err() {
        return Err((ErrorCode::TargetMissing, "It no longer exists. Rescan to update the list.".into()));
    }
    check(&t.path, t.allow_file)?;
    if let Some(p) = safety::within_any(&t.path, protected) {
        return Err((ErrorCode::TargetProtected, format!("Inside your protected path {}.", p.display())));
    }
    if let Some(p) = safety::contains_any(&t.path, protected) {
        return Err((ErrorCode::TargetProtected, format!("Contains your protected path {}.", p.display())));
    }
    if let Some(fp) = &t.fingerprint {
        if let Some(why) = safety::fingerprint_changed(fp, &t.path) {
            return Err((ErrorCode::TargetChanged, format!("It changed since the scan ({why}). Rescan before cleaning it.")));
        }
    }
    if t.needs_ack && !acknowledged {
        return Err((ErrorCode::NeedsAcknowledgement, "This may remove something you need. Confirm the warning to continue.".into()));
    }
    Ok(())
}

/// Remove one target after revalidating it. `protected` are the user's protected paths as they
/// are now (they may have changed since the scan).
pub fn execute(t: &Target, mode: DeleteMode, dry_run: bool, acknowledged: bool, protected: &[PathBuf]) -> DeleteOutcome {
    let fail = |code: ErrorCode, why: String| DeleteOutcome::refused(t, code, why, dry_run);
    if let Err((code, why)) = validate(t, acknowledged || dry_run, protected) {
        return fail(code, why);
    }
    let st = if t.path.is_dir() { crate::scanner::dir_stats(&t.path) } else { file_stats(&t.path) };
    let mut out = DeleteOutcome { ok: true, result: OutcomeKind::Removed, code: None, error: None, size_before: st.disk_bytes, estimated_bytes: st.reclaimable_bytes, ..fail(ErrorCode::Unknown, String::new()) };
    if dry_run {
        return out;
    }
    let res = match mode {
        DeleteMode::Trash => trash::delete(&t.path).map_err(|e| (ErrorCode::TrashFailed, "the Trash refused it".to_string(), e.to_string())),
        DeleteMode::Permanent => if t.path.is_dir() { fs::remove_dir_all(&t.path) } else { fs::remove_file(&t.path) }.map_err(|e| {
            let (c, m) = map_io(&e, "could not delete");
            (if c == ErrorCode::Unknown { ErrorCode::PermanentDeleteFailed } else { c }, m, e.to_string())
        }),
    };
    // Verify: whatever is still there was not removed.
    if t.path.exists() {
        let left = if t.path.is_dir() { crate::scanner::dir_stats(&t.path) } else { file_stats(&t.path) };
        let (code, why, raw) = res.err().unwrap_or((ErrorCode::PartialCleanup, String::new(), String::new()));
        out.ok = false;
        let partial = left.disk_bytes < st.disk_bytes;
        out.code = Some(if partial { ErrorCode::PartialCleanup } else { code });
        out.result = OutcomeKind::Failed;
        out.estimated_bytes = st.reclaimable_bytes.saturating_sub(left.reclaimable_bytes);
        out.error = Some(if partial {
            format!("Only part of it was removed; {} is still there{}", crate::recommend::fmt_bytes(left.disk_bytes), if why.is_empty() { String::new() } else { format!(" ({why})") })
        } else if why.is_empty() {
            "It is still there after removing it.".into()
        } else {
            format!("Could not remove it: {why}")
        });
        out.raw_error = (!raw.is_empty()).then_some(raw);
        return out;
    }
    for c in &t.companions {
        let _ = match mode {
            DeleteMode::Trash => trash::delete(c).map_err(|e| e.to_string()),
            DeleteMode::Permanent => fs::remove_file(c).map_err(|e| e.to_string()),
        };
    }
    out
}

fn file_stats(p: &Path) -> crate::scanner::DirStats {
    let mut s = crate::scanner::DirStats::default();
    if let Ok(md) = fs::symlink_metadata(p) {
        s.files = 1;
        s.apparent_bytes = md.len();
        s.disk_bytes = md.len();
        s.reclaimable_bytes = md.len();
    }
    s
}

/// Delete a folder by path with the basic checks only (no scan context). Kept for tests and tools.
pub fn delete_one(path: &Path, mode: DeleteMode, dry_run: bool) -> DeleteOutcome {
    let t = Target { id: crate::scanner::id_for(&path.to_string_lossy()), path: path.to_path_buf(), ..Default::default() };
    execute(&t, mode, dry_run, true, &[])
}

/// Free space on the volume holding `path` (or its nearest existing parent).
pub fn volume_free(path: &Path) -> Option<u64> {
    let mut p = Some(path);
    while let Some(x) = p {
        if x.exists() {
            return fs2::available_space(x).ok();
        }
        p = x.parent();
    }
    None
}

/// The result of one cleanup request.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeleteReport {
    pub outcomes: Vec<DeleteOutcome>,
    pub removed: usize,
    pub failed: usize,
    pub blocked: usize,
    pub skipped: usize,
    pub estimated_bytes: u64,
    /// Free space before and after (permanent deletes only; Trash keeps the space until emptied).
    pub volume_free_before: Option<u64>,
    pub volume_free_after: Option<u64>,
    pub dry_run: bool,
    pub mode: Option<DeleteMode>,
}

impl DeleteReport {
    pub fn new(outcomes: Vec<DeleteOutcome>, mode: DeleteMode, dry_run: bool, before: Option<u64>, after: Option<u64>) -> DeleteReport {
        let count = |k: OutcomeKind| outcomes.iter().filter(|o| o.result == k).count();
        DeleteReport {
            removed: count(OutcomeKind::Removed),
            failed: count(OutcomeKind::Failed),
            blocked: count(OutcomeKind::Blocked),
            skipped: count(OutcomeKind::Skipped),
            estimated_bytes: outcomes.iter().map(|o| o.estimated_bytes).sum(),
            volume_free_before: before,
            volume_free_after: after,
            dry_run,
            mode: Some(mode),
            outcomes,
        }
    }
}
