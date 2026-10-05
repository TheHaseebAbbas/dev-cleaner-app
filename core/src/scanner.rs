//! Finds cleanup candidates in project folders, identifies their project, measures them and
//! assesses them.
//!
//! Pipeline per candidate: detection → identity (project root) → path safety → Git → sensitive
//! files → risk and confidence → recommendation. Only then is it offered for selection.

pub use crate::model::{Level, Warning};
use crate::model::{Block, BlockSource, Category, Confidence, Cost, Fingerprint, GitStatus, Reason, Recommendation, Risk};
use crate::recommend::{self, Facts};
use crate::references::{Refs, REFERENCE_FILES};
use crate::rules::{marker_present, Rule, RULES_VERSION};
use crate::safety::{self, Sensitive};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    ffi::OsString,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

/// How project activity is measured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ActivityMode {
    /// Newest of the project's top-level entries (cheap, can miss deep edits).
    #[default]
    Fast,
    /// Newest file anywhere in the project, skipping build and dependency folders.
    Accurate,
}

/// Safety and recommendation switches that come from Settings.
#[derive(Debug, Clone)]
pub struct Policy {
    pub protect_git_tracked: bool,
    pub detect_sensitive_files: bool,
    pub activity_mode: ActivityMode,
    pub min_confidence: Confidence,
}

impl Default for Policy {
    fn default() -> Self {
        Policy { protect_git_tracked: true, detect_sensitive_files: true, activity_mode: ActivityMode::Fast, min_confidence: Confidence::High }
    }
}

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub roots: Vec<PathBuf>,
    pub rules: Vec<Rule>,
    /// Folder names the walker never enters. Detection still sees them (so Unity `Library` is found).
    pub exclude_names: Vec<String>,
    pub protected_paths: Vec<PathBuf>,
    pub max_depth: usize,
    pub policy: Policy,
    /// Identifies the settings a scan ran with.
    pub settings_hash: String,
}

/// An independently deletable direct child of a cleanup folder (e.g. `target/debug`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    pub path: String,
    pub name: String,
    pub disk_bytes: u64,
    pub apparent_bytes: u64,
    /// Space that would really come back (hard links shared with files outside are excluded).
    #[serde(default)]
    pub reclaimable_bytes: u64,
    pub file_count: u64,
    pub last_modified: u64,
    #[serde(default)]
    pub warning: Option<Warning>,
    /// Set when this part must not be removed (for example the version in use).
    #[serde(default)]
    pub block: Option<Block>,
    /// Overrides the owner's risk for this part (an unused SDK version is less risky than a used one).
    #[serde(default)]
    pub risk: Option<Risk>,
    #[serde(default)]
    pub usage: Option<crate::model::Usage>,
    #[serde(default)]
    pub recommendation: Option<Recommendation>,
    /// True when the part is a file rather than a folder (e.g. one Claude Code version).
    #[serde(default)]
    pub is_file: bool,
    #[serde(default)]
    pub fingerprint: Fingerprint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    /// Identifier within its scan.
    pub id: String,
    pub scan_id: String,
    /// Absolute path of the cleanup folder.
    pub path: String,
    pub rule_id: String,
    pub rule_version: u32,
    pub rule_name: String,
    pub ecosystem: String,
    pub category: Category,
    /// The project this belongs to: the repository root, or the outermost folder of a chain of
    /// project folders (so `app/android/app/build` belongs to `app`).
    pub project_path: String,
    pub project_name: String,
    /// The folder holding the rule's marker file, relative to the project (`android/app`); empty
    /// when it is the project itself.
    pub package_path: String,
    /// Real space used on disk, counting hard-linked files once.
    pub disk_bytes: u64,
    /// Sum of file lengths.
    pub apparent_bytes: u64,
    /// Estimated space actually recovered: excludes hard-linked files that also live elsewhere.
    pub reclaimable_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    /// Newest modification time inside the folder (unix seconds).
    pub last_modified: u64,
    /// Newest modification time among the project's own files, excluding cleanup folders.
    pub project_last_modified: u64,
    /// Recovery command; specific to the project where it can be detected (`pnpm install`).
    pub regenerates_with: String,
    pub description: String,
    /// What happens if it is removed.
    pub consequence: String,
    pub parts: Vec<Part>,
    /// Effective risk after context (Git, sensitive files, blocks).
    pub risk: Risk,
    pub confidence: Confidence,
    /// Why it was detected.
    pub detection: Vec<Reason>,
    pub rebuild_cost: Cost,
    pub network_cost: Cost,
    /// Rough upper bound of what may be downloaded again.
    pub download_bytes: u64,
    pub git: GitStatus,
    /// Reasons to think twice before deleting; empty means nothing special.
    pub warnings: Vec<Warning>,
    /// Why it cannot be removed, if it cannot.
    pub block: Option<Block>,
    pub recommendation: Recommendation,
    pub fingerprint: Fingerprint,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DirStats {
    pub disk_bytes: u64,
    pub apparent_bytes: u64,
    pub reclaimable_bytes: u64,
    pub files: u64,
    pub dirs: u64,
    pub newest: u64,
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

/// Accumulates sizes, counting each hard-linked file once and only treating it as reclaimable
/// when every link to it lies inside the measured tree.
#[derive(Default)]
pub struct Meter {
    st: DirStats,
    /// (device, inode) -> (link count, links seen, disk bytes)
    links: HashMap<(u64, u64), (u64, u64, u64)>,
    pub sensitive: Vec<(String, Sensitive)>,
    pub sensitive_count: u64,
    track_sensitive: bool,
}

impl Meter {
    pub fn new(track_sensitive: bool) -> Meter {
        Meter { track_sensitive, ..Default::default() }
    }

    pub fn add(&mut self, md: &std::fs::Metadata, name: &std::ffi::OsStr, path: &Path) {
        self.st.newest = self.st.newest.max(safety::mtime_secs(md));
        if md.is_dir() {
            self.st.dirs += 1;
            return;
        }
        self.st.files += 1;
        self.st.apparent_bytes += md.len();
        let disk = disk_len(md);
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if md.nlink() > 1 && !md.file_type().is_symlink() {
                let e = self.links.entry((md.dev(), md.ino())).or_insert((md.nlink(), 0, disk));
                e.1 += 1;
                if e.1 == 1 {
                    self.st.disk_bytes += disk;
                }
            } else {
                self.st.disk_bytes += disk;
                self.st.reclaimable_bytes += disk;
            }
        }
        #[cfg(not(unix))]
        {
            self.st.disk_bytes += disk;
            self.st.reclaimable_bytes += disk;
        }
        if self.track_sensitive {
            if let Some(kind) = safety::sensitive_name(&name.to_string_lossy()) {
                self.sensitive_count += 1;
                if self.sensitive.len() < 20 {
                    self.sensitive.push((path.to_string_lossy().into_owned(), kind));
                }
            }
        }
    }

    pub fn finish(mut self) -> (DirStats, Vec<(String, Sensitive)>, u64) {
        for (nlink, seen, disk) in self.links.values() {
            if seen >= nlink {
                self.st.reclaimable_bytes += disk;
            }
        }
        (self.st, self.sensitive, self.sensitive_count)
    }
}

/// Measure a tree without following symlinks.
pub fn dir_stats(path: &Path) -> DirStats {
    measure(path, false).0
}

fn measure(path: &Path, sensitive: bool) -> (DirStats, Vec<(String, Sensitive)>, u64, u64) {
    let mut m = Meter::new(sensitive);
    let mut errors = 0;
    for e in WalkDir::new(path).follow_links(false) {
        match e {
            Ok(e) => match e.metadata() {
                Ok(md) => m.add(&md, e.file_name(), e.path()),
                Err(_) => errors += 1,
            },
            Err(_) => errors += 1,
        }
    }
    let (st, s, n) = m.finish();
    (st, s, n, errors)
}

pub fn id_for(path: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Like [`dir_stats`], and also measures every direct child *directory* separately.
/// Returns no parts unless there are at least two.
pub fn dir_stats_parts(path: &Path) -> (DirStats, Vec<Part>) {
    let (total, mut parts, ..) = parts_measure(path, false, false);
    if parts.len() < 2 {
        parts.clear();
    }
    (total, parts)
}

/// Every direct child directory, even if there is only one.
pub fn dir_stats_parts_raw(path: &Path) -> (DirStats, Vec<Part>) {
    let (total, parts, ..) = parts_measure(path, false, false);
    (total, parts)
}

/// Measures the whole tree and each direct child. `files` also offers direct child files as parts.
pub fn parts_measure(path: &Path, files: bool, sensitive: bool) -> (DirStats, Vec<Part>, Vec<(String, Sensitive)>, u64, u64) {
    let mut total = Meter::new(sensitive);
    let mut errors = 0;
    let mut kids: BTreeMap<OsString, (bool, Meter)> = BTreeMap::new();
    for e in WalkDir::new(path).follow_links(false) {
        let Ok(e) = e else {
            errors += 1;
            continue;
        };
        let Ok(md) = e.metadata() else {
            errors += 1;
            continue;
        };
        total.add(&md, e.file_name(), e.path());
        let Ok(rel) = e.path().strip_prefix(path) else { continue };
        let Some(first) = rel.components().next() else { continue };
        let entry = kids.entry(first.as_os_str().to_owned()).or_default();
        if e.depth() == 1 {
            entry.0 = md.is_dir();
        }
        entry.1.add(&md, e.file_name(), e.path());
    }
    let mut parts: Vec<Part> = kids
        .into_iter()
        .filter(|(_, (is_dir, _))| *is_dir || files)
        .map(|(name, (is_dir, m))| {
            let (st, ..) = m.finish();
            let p = path.join(&name);
            let ps = p.to_string_lossy().into_owned();
            Part {
                id: id_for(&ps),
                fingerprint: safety::fingerprint(&p).unwrap_or_default(),
                path: ps,
                name: name.to_string_lossy().into_owned(),
                disk_bytes: st.disk_bytes,
                apparent_bytes: st.apparent_bytes,
                reclaimable_bytes: st.reclaimable_bytes,
                file_count: st.files,
                last_modified: st.newest,
                warning: None,
                block: None,
                risk: None,
                usage: None,
                recommendation: None,
                is_file: !is_dir,
            }
        })
        .collect();
    parts.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    let (st, s, n) = total.finish();
    (st, parts, s, n, errors)
}

/// Files that mark a folder as (part of) a project.
const ROOT_MARKERS: &[&str] = &[
    "package.json", "pubspec.yaml", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle",
    "settings.gradle.kts", "pyproject.toml", "setup.py", "go.mod", "composer.json", "Gemfile", "Package.swift", "mix.exs",
    "build.zig", "stack.yaml", "ProjectSettings", "Podfile", "*.sln", "*.csproj", "*.tf",
];

fn has_root_marker(dir: &Path) -> bool {
    ROOT_MARKERS.iter().any(|m| marker_present(dir, m))
}

/// The project a cleanup folder belongs to. `start` is the folder holding the rule's marker.
///
/// 1. The nearest Git repository root inside the scan folder (never the home folder itself).
/// 2. Otherwise the nearest folder with a project file, extended upwards while the parent is
///    also a project folder (`app/android/app` → `app/android` → `app`).
/// 3. Otherwise `start`.
pub fn project_root(start: &Path, scan_root: &Path) -> PathBuf {
    let home = dirs::home_dir();
    let is_home = |p: &Path| home.as_deref().is_some_and(|h| safety::same_path(h, p));
    let inside = |p: &Path| safety::is_within(p, scan_root) && !is_home(p);
    let mut d = Some(start);
    while let Some(x) = d {
        if !inside(x) {
            break;
        }
        if x.join(".git").exists() {
            return x.to_path_buf();
        }
        d = x.parent();
    }
    let mut d = Some(start);
    let mut first = None;
    while let Some(x) = d {
        if !inside(x) {
            break;
        }
        if has_root_marker(x) {
            first = Some(x);
            break;
        }
        d = x.parent();
    }
    let Some(mut best) = first else { return start.to_path_buf() };
    while let Some(p) = best.parent() {
        if inside(p) && has_root_marker(p) {
            best = p;
        } else {
            break;
        }
    }
    best.to_path_buf()
}

/// Folders skipped when measuring project activity in accurate mode.
const ACTIVITY_SKIP: &[&str] = &[".git", "node_modules", "build", "target", "Pods", "Library", ".dart_tool", ".gradle", ".venv", "venv", ".next", "dist", "vendor", "__pycache__", "DerivedData"];

/// Newest modification time of the project's own files, ignoring cleanup folders.
fn project_mtime(project: &Path, rules: &[Rule], mode: ActivityMode) -> u64 {
    let skip = |p: &Path| {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        ACTIVITY_SKIP.contains(&name.as_str()) || rules.iter().any(|r| r.matches(p))
    };
    let mut newest = 0;
    match mode {
        ActivityMode::Fast => {
            if let Ok(rd) = std::fs::read_dir(project) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() && skip(&p) {
                        continue;
                    }
                    if let Ok(md) = e.metadata() {
                        newest = newest.max(safety::mtime_secs(&md));
                    }
                }
            }
        }
        ActivityMode::Accurate => {
            let walker = WalkDir::new(project).follow_links(false).max_depth(12).into_iter().filter_entry(|e| e.depth() == 0 || !e.file_type().is_dir() || !skip(e.path()));
            for e in walker.flatten().take(200_000) {
                if e.file_type().is_file() {
                    if let Ok(md) = e.metadata() {
                        newest = newest.max(safety::mtime_secs(&md));
                    }
                }
            }
        }
    }
    newest
}

fn git_ok(repo: &Path, args: &[&str], target: &Path) -> Option<bool> {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .and_then(|s| match s.code() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        })
}

/// Git's view of `target`, looked up from the repository that contains `from`.
pub fn git_status(from: &Path, target: &Path) -> GitStatus {
    let mut dir = Some(from);
    while let Some(d) = dir {
        if d.join(".git").exists() {
            // Tracked files beat ignore rules (a force-added file inside an ignored folder is tracked).
            let tracked = git_ok(d, &["ls-files", "--error-unmatch", "--"], target);
            if tracked == Some(true) {
                let changed = Command::new("git")
                    .arg("-C")
                    .arg(d)
                    .args(["status", "--porcelain", "--untracked-files=no", "--"])
                    .arg(target)
                    .stderr(Stdio::null())
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| !o.stdout.is_empty());
                return if changed == Some(true) { GitStatus::Modified } else { GitStatus::Tracked };
            }
            return match git_ok(d, &["check-ignore", "-q", "--"], target) {
                Some(true) => GitStatus::Ignored,
                Some(false) if tracked == Some(false) => GitStatus::Untracked,
                _ => GitStatus::Unknown,
            };
        }
        dir = d.parent();
    }
    GitStatus::NotRepository
}

const REQUIREMENT_FILES: &[&str] = &["requirements.txt", "pyproject.toml", "Pipfile", "environment.yml", "setup.py", "setup.cfg", "poetry.lock", "uv.lock"];

/// Project-specific recovery command and a detection note, where it can be worked out.
fn recovery_for(rule: &Rule, package: &Path) -> (String, Option<String>) {
    let has = |f: &str| package.join(f).exists();
    match rule.id.as_str() {
        "node_modules" => {
            let (pm, cmd) = if has("pnpm-lock.yaml") {
                ("pnpm", "pnpm install")
            } else if has("yarn.lock") {
                ("yarn", "yarn install")
            } else if has("bun.lockb") || has("bun.lock") {
                ("bun", "bun install")
            } else if has("package-lock.json") {
                ("npm", "npm ci")
            } else {
                return ("npm install".into(), Some("Package manager: unknown (no lock file)".into()));
            };
            (cmd.into(), Some(format!("Package manager: {pm}")))
        }
        "python-venv" => {
            let cmd = if has("uv.lock") {
                "uv sync"
            } else if has("poetry.lock") {
                "poetry install"
            } else if has("Pipfile") {
                "pipenv install"
            } else if has("requirements.txt") {
                "python -m venv <dir> && pip install -r requirements.txt"
            } else if has("environment.yml") {
                "conda env create -f environment.yml"
            } else {
                return (rule.regenerates_with.clone(), None);
            };
            (cmd.into(), None)
        }
        "pods" if has("Podfile.lock") => ("pod install".into(), Some("Dependencies are pinned by Podfile.lock".into())),
        "php-vendor" if has("composer.lock") => ("composer install".into(), Some("Versions are pinned by composer.lock".into())),
        _ => (rule.regenerates_with.clone(), None),
    }
}

/// Categories whose contents come from package registries: credentials-looking files inside them
/// are almost always test fixtures shipped with packages.
pub fn downloaded(cat: Category) -> bool {
    matches!(cat, Category::ProjectDependency | Category::PackageCache | Category::VirtualEnvironment | Category::Sdk | Category::Toolchain)
}

/// Turns sensitive files found inside a candidate into a block, a warning, or nothing.
pub fn sensitive_policy(cat: Category, found: &[(String, Sensitive)], count: u64, root: &Path) -> (Option<Block>, Option<Warning>, bool) {
    if found.is_empty() {
        return (None, None, false);
    }
    let rel = |p: &str| Path::new(p).strip_prefix(root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_else(|_| p.into());
    let names: Vec<String> = found.iter().take(3).map(|(p, _)| rel(p)).collect();
    let more = count.saturating_sub(names.len() as u64);
    let list = format!("{}{}", names.join(", "), if more > 0 { format!(" and {more} more") } else { String::new() });
    if downloaded(cat) {
        return (None, Some(Warning::caution(format!("Contains files that look like keys or credentials ({list}). They usually come with downloaded packages, but check if you put any there yourself."))), false);
    }
    let signing: Vec<&(String, Sensitive)> = found.iter().filter(|(_, k)| *k == Sensitive::Signing).collect();
    if !signing.is_empty() {
        return (Some(Block::new(BlockSource::Sensitive, format!("Contains signing keys or certificates ({}). These are often impossible to recreate, so Dev Cleaner will not remove this folder. Move them out first.", rel(&signing[0].0)))), None, true);
    }
    (None, Some(Warning::danger(format!("Contains secrets such as .env files or private keys ({list}). Make sure you have them elsewhere before removing it."))), true)
}

/// Days between two unix times, `None` when unknown.
pub fn idle(newest: u64, now: u64) -> Option<u64> {
    (newest > 0).then(|| now.saturating_sub(newest) / 86_400)
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

/// Why the scanner did not look inside a folder, with a few examples.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkipStat {
    pub reason: String,
    pub count: u64,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScanSummary {
    pub scan_id: String,
    pub started_at: u64,
    pub completed_at: u64,
    /// False when the scan was cancelled: such a scan cannot be used for cleanup.
    pub complete: bool,
    pub cancelled: bool,
    pub roots: Vec<String>,
    pub dirs_visited: u64,
    pub files_visited: u64,
    pub found: u64,
    pub elapsed_ms: u64,
    pub discovery_ms: u64,
    pub measure_ms: u64,
    pub bytes_examined: u64,
    pub measure_errors: u64,
    pub skipped: Vec<SkipStat>,
    pub rules_active: usize,
    pub rules_version: u32,
    pub settings_hash: String,
    /// Scan folders that do not exist (so nothing could be scanned there).
    pub missing_roots: Vec<String>,
    /// SDK/toolchain versions the scanned projects use (feeds the Tools & SDKs screen).
    pub refs: Refs,
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn new_scan_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}", nanos, N.fetch_add(1, Ordering::Relaxed))
}

/// A matched folder, the rule that matched, and the scan folder it was found under.
pub struct Candidate {
    pub path: PathBuf,
    pub rule: Rule,
    pub root: PathBuf,
}

#[derive(Default)]
struct Skips(BTreeMap<&'static str, SkipStat>);

impl Skips {
    fn add(&mut self, reason: &'static str, p: &Path) {
        let s = self.0.entry(reason).or_insert_with(|| SkipStat { reason: reason.into(), ..Default::default() });
        s.count += 1;
        if s.examples.len() < 5 {
            s.examples.push(p.to_string_lossy().into_owned());
        }
    }
}

/// What the discovery walk saw.
#[derive(Default)]
pub struct Discovery {
    pub candidates: Vec<Candidate>,
    pub dirs_visited: u64,
    pub files_visited: u64,
    pub skipped: Vec<SkipStat>,
    /// Files that say which SDK/toolchain versions a project uses, with their scan folder.
    pub reference_files: Vec<(PathBuf, PathBuf)>,
}

/// Phase 1: walk the roots and collect matching directories, never descending into a match.
pub fn discover(opts: &ScanOptions, cancel: &AtomicBool) -> Vec<Candidate> {
    discover_with(opts, cancel, &|_| {}).candidates
}

/// Like [`discover`], also reporting progress about every 200 folders.
pub fn discover_with(opts: &ScanOptions, cancel: &AtomicBool, on_progress: &(dyn Fn(Progress) + Sync)) -> Discovery {
    let rules: Vec<&Rule> = opts.rules.iter().filter(|r| r.enabled).collect();
    let mut found: Vec<Candidate> = vec![];
    let mut visited: u64 = 0;
    let mut files: u64 = 0;
    let mut refs: Vec<(PathBuf, PathBuf)> = vec![];
    let skips = std::cell::RefCell::new(Skips::default());
    for root in &opts.roots {
        let walker = WalkDir::new(root)
            .follow_links(false)
            .max_depth(opts.max_depth)
            .into_iter()
            .filter_entry(|e| {
                if cancel.load(Ordering::Relaxed) {
                    return false;
                }
                if e.path_is_symlink() && e.depth() > 0 {
                    if std::fs::metadata(e.path()).is_ok_and(|m| m.is_dir()) {
                        skips.borrow_mut().add("Symbolic link (not followed)", e.path());
                    }
                    return false;
                }
                if !e.file_type().is_dir() || e.depth() == 0 {
                    return true;
                }
                visited += 1;
                if visited % 200 == 0 {
                    on_progress(Progress::Discover { visited, found: found.len() as u64, current: e.path().to_string_lossy().into_owned() });
                }
                // Detection runs before traversal exclusions, on purpose.
                if let Some(rule) = rules.iter().find(|r| r.matches(e.path())) {
                    found.push(Candidate { path: e.path().to_path_buf(), rule: (*rule).clone(), root: root.clone() });
                    return false;
                }
                let name = e.file_name().to_string_lossy();
                if opts.exclude_names.iter().any(|x| *x == *name) {
                    skips.borrow_mut().add("Skipped folder name", e.path());
                    return false;
                }
                if e.depth() == opts.max_depth {
                    skips.borrow_mut().add("Search depth limit reached", e.path());
                }
                true
            });
        for e in walker {
            match e {
                Ok(e) if !e.file_type().is_dir() => {
                    files += 1;
                    if REFERENCE_FILES.iter().any(|n| e.file_name() == *n) {
                        refs.push((e.path().to_path_buf(), root.clone()));
                    }
                }
                Ok(_) => {}
                Err(err) => {
                    let p = err.path().map(Path::to_path_buf).unwrap_or_default();
                    skips.borrow_mut().add("Could not be read (permissions)", &p);
                }
            }
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found.dedup_by(|a, b| a.path == b.path);
    // Folders that were matched are not walked into, but some hold references themselves.
    for c in &found {
        let f = c.path.join("fvm_config.json");
        if c.rule.id == "fvm" && f.is_file() {
            refs.push((f, c.root.clone()));
        }
    }
    Discovery { candidates: found, dirs_visited: visited, files_visited: files, skipped: skips.into_inner().0.into_values().collect(), reference_files: refs }
}

/// Full scan. `on_item` is called (possibly from worker threads) as each item is measured.
pub fn scan<F>(opts: &ScanOptions, cancel: &AtomicBool, on_item: F) -> Vec<Item>
where
    F: Fn(&Item) + Sync,
{
    scan_with_progress(opts, cancel, on_item, |_| {}).0
}

fn path_block(path: &Path, protected: &[PathBuf]) -> Option<Block> {
    if let Some(b) = safety::system_block(path) {
        return Some(b);
    }
    if let Some(p) = safety::within_any(path, protected) {
        return Some(Block::new(BlockSource::User, format!("Inside your protected path {}.", p.display())));
    }
    if let Some(p) = safety::contains_any(path, protected) {
        return Some(Block::new(BlockSource::User, format!("Contains your protected path {}.", p.display())));
    }
    if let Some(kind) = safety::redirection(path) {
        return Some(Block::new(BlockSource::System, format!("This is a {kind}. Dev Cleaner never deletes through links or mounted folders.")));
    }
    None
}

/// Assess one candidate. Separate from discovery so it can be tested on its own.
pub fn assess(c: &Candidate, opts: &ScanOptions, scan_id: &str, now: u64, ctx: &Ctx) -> (Item, u64) {
    let rule = &c.rule;
    let path = &c.path;
    let package = path.parent().unwrap_or(path);
    let project = ctx.root(package, &c.root);
    let policy = &opts.policy;

    let (st, mut parts, sensitive, sensitive_count, errors) = parts_measure(path, false, policy.detect_sensitive_files);
    if !rule.split || parts.len() < 2 {
        parts.clear();
    }
    let pm = ctx.activity(&project, &opts.rules, policy.activity_mode);
    let git = git_status(package, path);

    // Detection evidence and confidence
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut detection = vec![Reason::yes(format!("Folder name is {name}"))];
    let mut confidence = rule.base_confidence;
    for m in rule.parent_markers.iter().filter(|m| marker_present(package, m)) {
        detection.push(Reason::yes(format!("{} is next to it", m.trim_start_matches("../"))));
    }
    for m in rule.self_markers.iter().filter(|m| marker_present(path, m)) {
        detection.push(Reason::yes(format!("Contains {m}")));
    }
    let support: Vec<&String> = rule.confidence_markers.iter().filter(|m| marker_present(package, m)).collect();
    if !support.is_empty() {
        confidence = confidence.up();
        detection.push(Reason::yes(format!("{} found", support.iter().map(|s| s.trim_start_matches("../")).collect::<Vec<_>>().join(", "))));
    } else if !rule.confidence_markers.is_empty() && rule.parent_markers.is_empty() && rule.self_markers.is_empty() {
        confidence = confidence.down();
    }
    let (recovery, note) = recovery_for(rule, package);
    if let Some(n) = note {
        detection.push(Reason::yes(n));
    }

    // Context
    let mut warnings = vec![];
    let mut block = path_block(path, &opts.protected_paths);
    match git {
        GitStatus::Ignored => {
            confidence = confidence.up();
            detection.push(Reason::yes("Git ignores it"));
        }
        GitStatus::Untracked => {
            confidence = confidence.down();
            detection.push(Reason::no("Not listed in .gitignore"));
            warnings.push(Warning::caution("This folder is not listed in .gitignore. Make sure it only holds generated files and nothing you created by hand."));
        }
        GitStatus::Tracked | GitStatus::Modified => {
            confidence = Confidence::Low;
            detection.push(Reason::no("Git tracks files inside it"));
            let modified = git == GitStatus::Modified;
            let msg = format!(
                "Git tracks files inside this folder, so it is part of your repository{}. Removing it changes the repository.",
                if modified { " and some of them have uncommitted changes" } else { "" }
            );
            if policy.protect_git_tracked {
                block.get_or_insert(Block::new(BlockSource::Git, format!("{msg} Turn off \"Protect Git-tracked folders\" in Settings to allow it.")));
            } else {
                warnings.push(Warning::danger(msg));
            }
        }
        _ => {}
    }
    let mut risk = rule.risk;
    if rule.id == "python-venv" && !REQUIREMENT_FILES.iter().any(|f| package.join(f).exists()) {
        warnings.push(Warning::danger("No requirements.txt, pyproject.toml, Pipfile or uv.lock was found next to this environment, so you may not be able to recreate the packages installed in it."));
    }
    if rule.custom && rule.risk >= Risk::Danger {
        warnings.push(Warning::danger("Your custom rule marks this folder as dangerous: it may hold data that is hard to recreate."));
    }
    let (sblock, swarn, critical) = sensitive_policy(rule.category, &sensitive, sensitive_count, path);
    if let Some(b) = sblock {
        block.get_or_insert(b);
    }
    warnings.extend(swarn);
    if critical {
        risk = risk.max(Risk::Critical);
    }
    if let Some(d) = idle(pm, now).filter(|d| *d < recommend::RECENT_DAYS) {
        warnings.push(Warning::caution(format!(
            "The project was changed {}. You may be working on it right now, and it will need a rebuild.",
            if d == 0 { "today".to_string() } else { format!("{d} day{} ago", if d == 1 { "" } else { "s" }) }
        )));
    }
    if block.is_some() {
        risk = Risk::Blocked;
    }
    let download = (st.disk_bytes as f64 * rule.category.download_factor()) as u64;
    let download = if rule.network_cost >= Cost::Medium && rule.network_cost != Cost::Unknown { download } else { 0 };
    let recommendation = recommend::recommend(&Facts {
        risk,
        category: rule.category,
        confidence,
        min_confidence: policy.min_confidence,
        block: block.as_ref(),
        git,
        reclaimable: st.reclaimable_bytes,
        idle_days: idle(st.newest, now),
        project_idle_days: idle(pm, now),
        rebuild_cost: rule.rebuild_cost,
        network_cost: rule.network_cost,
        download_bytes: download,
        warnings: &warnings,
        usage: None,
    });
    let rel = package.strip_prefix(&project).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let ps = path.to_string_lossy().into_owned();
    let item = Item {
        id: id_for(&ps),
        scan_id: scan_id.into(),
        fingerprint: safety::fingerprint(path).unwrap_or_default(),
        path: ps,
        rule_id: rule.id.clone(),
        rule_version: rule.version,
        rule_name: rule.name.clone(),
        ecosystem: rule.ecosystem.clone(),
        category: rule.category,
        project_path: project.to_string_lossy().into_owned(),
        project_name: project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        package_path: rel,
        disk_bytes: st.disk_bytes,
        apparent_bytes: st.apparent_bytes,
        reclaimable_bytes: st.reclaimable_bytes,
        file_count: st.files,
        dir_count: st.dirs,
        last_modified: st.newest,
        project_last_modified: pm,
        regenerates_with: recovery,
        description: rule.description.clone(),
        consequence: rule.consequence.clone(),
        parts,
        risk,
        confidence,
        detection,
        rebuild_cost: rule.rebuild_cost,
        network_cost: rule.network_cost,
        download_bytes: download,
        git,
        warnings,
        block,
        recommendation,
    };
    (item, errors)
}

/// Caches shared by all candidates of one scan (project roots and activity are per project).
#[derive(Default)]
pub struct Ctx {
    roots: Mutex<HashMap<PathBuf, PathBuf>>,
    activity: Mutex<HashMap<PathBuf, u64>>,
}

impl Ctx {
    fn root(&self, package: &Path, scan_root: &Path) -> PathBuf {
        if let Some(r) = self.roots.lock().unwrap().get(package) {
            return r.clone();
        }
        let r = project_root(package, scan_root);
        self.roots.lock().unwrap().insert(package.to_path_buf(), r.clone());
        r
    }
    fn activity(&self, project: &Path, rules: &[Rule], mode: ActivityMode) -> u64 {
        if let Some(t) = self.activity.lock().unwrap().get(project) {
            return *t;
        }
        let t = project_mtime(project, rules, mode);
        self.activity.lock().unwrap().insert(project.to_path_buf(), t);
        t
    }
}

/// Full scan with progress events and a summary.
pub fn scan_with_progress<F, P>(opts: &ScanOptions, cancel: &AtomicBool, on_item: F, on_progress: P) -> (Vec<Item>, ScanSummary)
where
    F: Fn(&Item) + Sync,
    P: Fn(Progress) + Sync,
{
    let scan_id = new_scan_id();
    let started_at = now_secs();
    let started = std::time::Instant::now();
    let missing_roots: Vec<String> = opts.roots.iter().filter(|r| !r.is_dir()).map(|r| r.to_string_lossy().into_owned()).collect();
    let Discovery { candidates, dirs_visited, files_visited, skipped, reference_files } = discover_with(opts, cancel, &on_progress);
    let discovery_ms = started.elapsed().as_millis() as u64;
    let measure_start = std::time::Instant::now();
    let total = candidates.len() as u64;
    let done = AtomicU64::new(0);
    let errors = AtomicU64::new(0);
    let ctx = Ctx::default();
    on_progress(Progress::Measure { done: 0, total, current: String::new() });
    let now = now_secs();
    let mut items: Vec<Item> = candidates
        .par_iter()
        .filter_map(|c| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let (item, errs) = assess(c, opts, &scan_id, now, &ctx);
            errors.fetch_add(errs, Ordering::Relaxed);
            on_item(&item);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(Progress::Measure { done: n, total, current: item.path.clone() });
            Some(item)
        })
        .collect();
    items.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    let cancelled = cancel.load(Ordering::Relaxed);
    let named: Vec<(PathBuf, String)> = reference_files
        .iter()
        .map(|(f, root)| {
            let dir = f.parent().unwrap_or(f);
            let dir = if dir.file_name().is_some_and(|n| n == ".fvm" || n == "wrapper") { dir.parent().unwrap_or(dir) } else { dir };
            let p = ctx.root(dir, root);
            (f.clone(), p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
        })
        .collect();
    let mut projects: std::collections::BTreeSet<String> = items.iter().map(|i| i.project_path.clone()).collect();
    projects.extend(reference_files.iter().map(|(f, root)| ctx.root(f.parent().unwrap_or(f), root).to_string_lossy().into_owned()));
    let refs = Refs::collect(&named, projects.len());
    let summary = ScanSummary {
        scan_id,
        started_at,
        completed_at: now_secs(),
        complete: !cancelled,
        cancelled,
        roots: opts.roots.iter().map(|r| r.to_string_lossy().into_owned()).collect(),
        dirs_visited,
        files_visited,
        found: items.len() as u64,
        elapsed_ms: started.elapsed().as_millis() as u64,
        discovery_ms,
        measure_ms: measure_start.elapsed().as_millis() as u64,
        bytes_examined: items.iter().map(|i| i.apparent_bytes).sum(),
        measure_errors: errors.load(Ordering::Relaxed),
        skipped,
        rules_active: opts.rules.iter().filter(|r| r.enabled).count(),
        rules_version: RULES_VERSION,
        settings_hash: opts.settings_hash.clone(),
        missing_roots,
        refs,
    };
    (items, summary)
}
