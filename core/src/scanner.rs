//! Finds rebuildable artifact directories and measures them.

use crate::rules::{Risk, Rule};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub roots: Vec<PathBuf>,
    pub rules: Vec<Rule>,
    pub exclude_names: Vec<String>,
    pub protected_paths: Vec<PathBuf>,
    pub max_depth: usize,
}

/// An independently deletable direct child of an artifact folder (e.g. `target/debug`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub path: String,
    pub name: String,
    pub disk_bytes: u64,
    pub apparent_bytes: u64,
    pub file_count: u64,
    pub last_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    /// Absolute path of the artifact directory; also its identifier.
    pub path: String,
    pub rule_id: String,
    pub rule_name: String,
    pub ecosystem: String,
    pub project_path: String,
    pub project_name: String,
    /// Real space used on disk (allocated blocks where available).
    pub disk_bytes: u64,
    /// Sum of file lengths.
    pub apparent_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    /// Newest modification time inside the artifact (unix seconds).
    pub last_modified: u64,
    /// Newest modification time among the project's own files, excluding artifacts (unix seconds).
    pub project_last_modified: u64,
    pub regenerates_with: String,
    pub description: String,
    /// Independent sub-folders; empty unless the rule splits and there are at least two.
    pub parts: Vec<Part>,
    pub risk: Risk,
    /// `Some(true)` if git ignores it, `Some(false)` if tracked/not ignored, `None` if not a git repo.
    pub git_ignored: Option<bool>,
    pub protected: bool,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DirStats {
    pub disk_bytes: u64,
    pub apparent_bytes: u64,
    pub files: u64,
    pub dirs: u64,
    pub newest: u64,
}

fn mtime_secs(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(unix)]
fn disk_len(md: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    md.blocks() * 512
}
#[cfg(not(unix))]
fn disk_len(md: &std::fs::Metadata) -> u64 {
    md.len()
}

fn add(s: &mut DirStats, md: &std::fs::Metadata) {
    s.newest = s.newest.max(mtime_secs(md));
    if md.is_dir() {
        s.dirs += 1;
    } else {
        s.files += 1;
        s.apparent_bytes += md.len();
        s.disk_bytes += disk_len(md);
    }
}

/// Measure a directory tree without following symlinks.
pub fn dir_stats(path: &Path) -> DirStats {
    let mut s = DirStats::default();
    for e in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if let Ok(md) = e.metadata() {
            add(&mut s, &md);
        }
    }
    s
}

/// Like [`dir_stats`], and also measures every direct child *directory* separately.
/// Returns no parts unless there are at least two.
pub fn dir_stats_parts(path: &Path) -> (DirStats, Vec<Part>) {
    use std::collections::BTreeMap;
    let mut total = DirStats::default();
    let mut kids: BTreeMap<std::ffi::OsString, (bool, DirStats)> = BTreeMap::new();
    for e in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        let Ok(md) = e.metadata() else { continue };
        add(&mut total, &md);
        let Ok(rel) = e.path().strip_prefix(path) else { continue };
        let Some(first) = rel.components().next() else { continue };
        let entry = kids.entry(first.as_os_str().to_owned()).or_default();
        if e.depth() == 1 {
            entry.0 = md.is_dir();
        }
        add(&mut entry.1, &md);
    }
    let mut parts: Vec<Part> = kids
        .into_iter()
        .filter(|(_, (is_dir, _))| *is_dir)
        .map(|(name, (_, st))| Part {
            path: path.join(&name).to_string_lossy().into_owned(),
            name: name.to_string_lossy().into_owned(),
            disk_bytes: st.disk_bytes,
            apparent_bytes: st.apparent_bytes,
            file_count: st.files,
            last_modified: st.newest,
        })
        .collect();
    if parts.len() < 2 {
        parts.clear();
    }
    parts.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    (total, parts)
}

/// Newest mtime among the project's top-level entries, ignoring the artifact dirs themselves.
fn project_mtime(project: &Path, rules: &[Rule]) -> u64 {
    let mut newest = 0;
    if let Ok(rd) = std::fs::read_dir(project) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && rules.iter().any(|r| r.matches(&p)) {
                continue;
            }
            if e.file_name() == ".git" {
                continue;
            }
            if let Ok(md) = e.metadata() {
                newest = newest.max(mtime_secs(&md));
            }
        }
    }
    newest
}

fn git_ignored(project: &Path, artifact: &Path) -> Option<bool> {
    let mut dir = Some(project);
    while let Some(d) = dir {
        if d.join(".git").exists() {
            let status = Command::new("git")
                .arg("-C")
                .arg(d)
                .args(["check-ignore", "-q", "--"])
                .arg(artifact)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .ok()?;
            return match status.code() {
                Some(0) => Some(true),
                Some(1) => Some(false),
                _ => None,
            };
        }
        dir = d.parent();
    }
    None
}

/// Phase 1: walk the roots and collect matching directories, never descending into a match.
pub fn discover(opts: &ScanOptions, cancel: &AtomicBool) -> Vec<(PathBuf, Rule)> {
    let rules: Vec<&Rule> = opts.rules.iter().filter(|r| r.enabled).collect();
    let mut found: Vec<(PathBuf, Rule)> = vec![];
    for root in &opts.roots {
        let walker = WalkDir::new(root)
            .follow_links(false)
            .max_depth(opts.max_depth)
            .into_iter()
            .filter_entry(|e| {
                if cancel.load(Ordering::Relaxed) {
                    return false;
                }
                if !e.file_type().is_dir() || e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                if let Some(rule) = rules.iter().find(|r| r.matches(e.path())) {
                    found.push((e.path().to_path_buf(), (*rule).clone()));
                    return false;
                }
                !opts.exclude_names.iter().any(|x| *x == *name)
            });
        for _ in walker {}
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found.dedup_by(|a, b| a.0 == b.0);
    found
}

/// Full scan. `on_item` is called (possibly from worker threads) as each item is measured.
pub fn scan<F>(opts: &ScanOptions, cancel: &AtomicBool, on_item: F) -> Vec<Item>
where
    F: Fn(&Item) + Sync,
{
    let candidates = discover(opts, cancel);
    let mut items: Vec<Item> = candidates
        .par_iter()
        .filter_map(|(path, rule)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let project = path.parent().unwrap_or(path);
            let (st, parts) = if rule.split {
                dir_stats_parts(path)
            } else {
                (dir_stats(path), vec![])
            };
            let item = Item {
                path: path.to_string_lossy().into_owned(),
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                ecosystem: rule.ecosystem.clone(),
                project_path: project.to_string_lossy().into_owned(),
                project_name: project
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                disk_bytes: st.disk_bytes,
                apparent_bytes: st.apparent_bytes,
                file_count: st.files,
                dir_count: st.dirs,
                last_modified: st.newest,
                project_last_modified: project_mtime(project, &opts.rules),
                regenerates_with: rule.regenerates_with.clone(),
                description: rule.description.clone(),
                parts,
                risk: rule.risk,
                git_ignored: git_ignored(project, path),
                protected: opts.protected_paths.iter().any(|p| path.starts_with(p)),
            };
            on_item(&item);
            Some(item)
        })
        .collect();
    items.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    items
}
