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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Worth knowing before you delete.
    Caution,
    /// Deleting may lose data that cannot be recreated, or break something that is required.
    Danger,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Warning {
    pub level: Level,
    pub message: String,
}

impl Warning {
    pub fn caution(m: impl Into<String>) -> Warning {
        Warning { level: Level::Caution, message: m.into() }
    }
    pub fn danger(m: impl Into<String>) -> Warning {
        Warning { level: Level::Danger, message: m.into() }
    }
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
    #[serde(default)]
    pub warning: Option<Warning>,
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
    /// `Some(true)` if git tracks files inside it (so it is part of the repository).
    pub git_tracked: Option<bool>,
    /// Reasons to think twice before deleting; empty means nothing special.
    pub warnings: Vec<Warning>,
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
    let (total, mut parts) = dir_stats_parts_raw(path);
    if parts.len() < 2 {
        parts.clear();
    }
    (total, parts)
}

/// Every direct child directory, even if there is only one.
pub fn dir_stats_parts_raw(path: &Path) -> (DirStats, Vec<Part>) {
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
            warning: None,
        })
        .collect();
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

/// (ignored by git, tracked by git); `None` when not inside a git repository or git is missing.
fn git_state(project: &Path, artifact: &Path) -> (Option<bool>, Option<bool>) {
    let mut dir = Some(project);
    while let Some(d) = dir {
        if d.join(".git").exists() {
            let ignored = Command::new("git")
                .arg("-C")
                .arg(d)
                .args(["check-ignore", "-q", "--"])
                .arg(artifact)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .ok()
                .and_then(|s| match s.code() {
                    Some(0) => Some(true),
                    Some(1) => Some(false),
                    _ => None,
                });
            let tracked = if ignored == Some(true) {
                Some(false)
            } else {
                Command::new("git")
                    .arg("-C")
                    .arg(d)
                    .args(["ls-files", "-z", "--"])
                    .arg(artifact)
                    .stderr(Stdio::null())
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| !o.stdout.is_empty())
            };
            return (ignored, tracked);
        }
        dir = d.parent();
    }
    (None, None)
}

const RECENT_DAYS: u64 = 3;
const REQUIREMENT_FILES: &[&str] = &["requirements.txt", "pyproject.toml", "Pipfile", "environment.yml", "setup.py", "setup.cfg", "poetry.lock"];

/// Reasons to think twice before deleting this folder.
fn assess(rule: &Rule, project: &Path, git_ignored: Option<bool>, git_tracked: Option<bool>, project_mtime: u64, now: u64) -> Vec<Warning> {
    let mut w = vec![];
    if git_tracked == Some(true) {
        w.push(Warning::danger("Git tracks files inside this folder, so it is part of your repository. Removing it deletes committed files, and any uncommitted changes in it are lost."));
    } else if git_ignored == Some(false) {
        w.push(Warning::caution("This folder is not listed in .gitignore. Make sure it only holds generated files and nothing you created by hand."));
    }
    if rule.id == "python-venv" && !REQUIREMENT_FILES.iter().any(|f| project.join(f).exists()) {
        w.push(Warning::danger("No requirements.txt, pyproject.toml or Pipfile was found next to this environment, so you may not be able to recreate the packages installed in it."));
    }
    if rule.risk == crate::rules::Risk::High {
        w.push(Warning::danger("This rule is marked high risk: the folder may hold data that is hard to recreate."));
    }
    if project_mtime > 0 && now.saturating_sub(project_mtime) < RECENT_DAYS * 86400 {
        let days = now.saturating_sub(project_mtime) / 86400;
        w.push(Warning::caution(format!(
            "The project was changed {} ago. You may be working on it right now, and it will need a rebuild.",
            if days == 0 { "today".to_string() } else { format!("{days} day{}", if days == 1 { "" } else { "s" }) }
        )));
    }
    w
}

/// Progress reported while scanning.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Progress {
    /// Walking the folders looking for matches.
    Discover { visited: u64, found: u64, current: String },
    /// Measuring the folders that were found.
    Measure { done: u64, total: u64, current: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanSummary {
    pub dirs_visited: u64,
    pub found: u64,
    pub elapsed_ms: u64,
    pub cancelled: bool,
    /// Scan folders that do not exist (so nothing could be scanned there).
    pub missing_roots: Vec<String>,
}

/// Phase 1: walk the roots and collect matching directories, never descending into a match.
pub fn discover(opts: &ScanOptions, cancel: &AtomicBool) -> Vec<(PathBuf, Rule)> {
    discover_with(opts, cancel, &|_| {}).0
}

/// Like [`discover`], also reporting progress about every 200 folders. Returns the folders visited.
pub fn discover_with(opts: &ScanOptions, cancel: &AtomicBool, on_progress: &(dyn Fn(Progress) + Sync)) -> (Vec<(PathBuf, Rule)>, u64) {
    let rules: Vec<&Rule> = opts.rules.iter().filter(|r| r.enabled).collect();
    let mut found: Vec<(PathBuf, Rule)> = vec![];
    let mut visited: u64 = 0;
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
                visited += 1;
                if visited % 200 == 0 {
                    on_progress(Progress::Discover { visited, found: found.len() as u64, current: e.path().to_string_lossy().into_owned() });
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
    (found, visited)
}

/// Full scan. `on_item` is called (possibly from worker threads) as each item is measured.
pub fn scan<F>(opts: &ScanOptions, cancel: &AtomicBool, on_item: F) -> Vec<Item>
where
    F: Fn(&Item) + Sync,
{
    scan_with_progress(opts, cancel, on_item, |_| {}).0
}

/// Full scan with progress events and a summary.
pub fn scan_with_progress<F, P>(opts: &ScanOptions, cancel: &AtomicBool, on_item: F, on_progress: P) -> (Vec<Item>, ScanSummary)
where
    F: Fn(&Item) + Sync,
    P: Fn(Progress) + Sync,
{
    let started = std::time::Instant::now();
    let missing_roots: Vec<String> = opts.roots.iter().filter(|r| !r.is_dir()).map(|r| r.to_string_lossy().into_owned()).collect();
    let (candidates, dirs_visited) = discover_with(opts, cancel, &on_progress);
    let total = candidates.len() as u64;
    let done = std::sync::atomic::AtomicU64::new(0);
    on_progress(Progress::Measure { done: 0, total, current: String::new() });
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
            let pm = project_mtime(project, &opts.rules);
            let (ignored, tracked) = git_state(project, path);
            let now = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let item = Item {
                warnings: assess(rule, project, ignored, tracked, pm, now),
                git_tracked: tracked,
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
                project_last_modified: pm,
                regenerates_with: rule.regenerates_with.clone(),
                description: rule.description.clone(),
                parts,
                risk: rule.risk,
                git_ignored: ignored,
                protected: opts.protected_paths.iter().any(|p| path.starts_with(p)),
            };
            on_item(&item);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(Progress::Measure { done: n, total, current: item.path.clone() });
            Some(item)
        })
        .collect();
    items.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    let summary = ScanSummary { dirs_visited, found: items.len() as u64, elapsed_ms: started.elapsed().as_millis() as u64, cancelled: cancel.load(Ordering::Relaxed), missing_roots };
    (items, summary)
}
