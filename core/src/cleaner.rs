//! Safe deletion (Trash by default) with dry-run support.

use crate::settings::DeleteMode;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteOutcome {
    pub path: String,
    pub ok: bool,
    pub bytes_freed: u64,
    pub error: Option<String>,
    pub dry_run: bool,
}

/// Refuse anything that is not an existing directory, is a filesystem root or home,
/// or is too shallow to plausibly be a build artifact.
pub fn check_target(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    if path.components().count() < 3 {
        return Err("path too close to filesystem root".into());
    }
    if let Some(home) = dirs::home_dir() {
        if path == home || home.starts_with(path) {
            return Err("refusing to delete the home directory or a parent of it".into());
        }
    }
    let md = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if md.file_type().is_symlink() {
        return Err("path is a symlink".into());
    }
    if !md.is_dir() {
        return Err("not a directory".into());
    }
    Ok(())
}

pub fn delete_one(path: &Path, mode: DeleteMode, dry_run: bool) -> DeleteOutcome {
    let fail = |e: String| DeleteOutcome {
        path: path.to_string_lossy().into_owned(),
        ok: false,
        bytes_freed: 0,
        error: Some(e),
        dry_run,
    };
    if let Err(e) = check_target(path) {
        return fail(e);
    }
    let bytes = crate::scanner::dir_stats(path).disk_bytes;
    if !dry_run {
        let res = match mode {
            DeleteMode::Trash => trash::delete(path).map_err(|e| e.to_string()),
            DeleteMode::Permanent => fs::remove_dir_all(path).map_err(|e| e.to_string()),
        };
        if let Err(e) = res {
            return fail(e);
        }
    }
    DeleteOutcome {
        path: path.to_string_lossy().into_owned(),
        ok: true,
        bytes_freed: bytes,
        error: None,
        dry_run,
    }
}
