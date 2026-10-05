//! "Is this folder being used right now?"
//!
//! One snapshot of running processes is taken per scan or cleanup and every candidate is checked
//! against it. A process counts as using a folder when its executable or working directory is
//! inside it, when (on Linux) it holds a file inside it open, or when it is a well-known tool
//! process for that location (a Gradle daemon for Gradle caches, an emulator for its AVD).
//!
//! Detection is best effort. When it cannot run, the answer is `Unknown`, never "not in use".
//! On Windows, files that cannot be opened exclusively are reported as locked.

use crate::safety;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InUseStatus {
    /// A running process uses it, or some files are locked.
    InUse,
    /// Nothing was found. Not a guarantee: a process can start at any time.
    NotDetected,
    /// Detection is not available here.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveUse {
    pub status: InUseStatus,
    /// Process names (with pid) that use it.
    #[serde(default)]
    pub by: Vec<String>,
    /// Files that could not be opened exclusively (Windows only).
    #[serde(default)]
    pub locked_files: u64,
    #[serde(default)]
    pub locked_bytes: u64,
}

impl ActiveUse {
    pub fn unknown() -> ActiveUse {
        ActiveUse { status: InUseStatus::Unknown, by: vec![], locked_files: 0, locked_bytes: 0 }
    }
    pub fn in_use(&self) -> bool {
        self.status == InUseStatus::InUse
    }
    /// One sentence for warnings and errors.
    pub fn describe(&self) -> String {
        let mut s = String::new();
        if !self.by.is_empty() {
            s = format!("In use by {}", self.by.join(", "));
        }
        if self.locked_files > 0 {
            if !s.is_empty() {
                s.push_str("; ");
            }
            s.push_str(&format!("{} file{} locked", self.locked_files, if self.locked_files == 1 { " is" } else { "s are" }));
        }
        if s.is_empty() { "In use".into() } else { s }
    }
}

#[derive(Debug, Clone)]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub exe: Option<PathBuf>,
    pub cwd: Option<PathBuf>,
    pub cmd: String,
}

/// Running processes and (on Linux) the files they hold open.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub procs: Vec<Proc>,
    /// (pid, path) for open files; empty where it cannot be read.
    pub open_files: Vec<(u32, PathBuf)>,
}

impl Snapshot {
    /// Takes a snapshot, or None when process information is not available on this system.
    pub fn take() -> Option<Snapshot> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        if !sysinfo::IS_SUPPORTED_SYSTEM {
            return None;
        }
        let mut sys = System::new();
        let kind = ProcessRefreshKind::nothing().with_exe(UpdateKind::Always).with_cwd(UpdateKind::Always).with_cmd(UpdateKind::Always);
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        let me = std::process::id();
        let procs: Vec<Proc> = sys
            .processes()
            .iter()
            .filter(|(pid, _)| pid.as_u32() != me)
            .map(|(pid, p)| Proc {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                exe: p.exe().map(Path::to_path_buf),
                cwd: p.cwd().map(Path::to_path_buf),
                cmd: p.cmd().iter().map(|c| c.to_string_lossy()).collect::<Vec<_>>().join(" "),
            })
            .collect();
        if procs.is_empty() {
            return None;
        }
        Some(Snapshot { open_files: open_files(&procs), procs })
    }

    /// Which processes use `path`. `kind_hint` is a location id (e.g. "gradle-caches",
    /// "android-avd") that enables tool-specific signals.
    pub fn check(&self, path: &Path, kind_hint: &str) -> ActiveUse {
        let mut by: Vec<String> = vec![];
        let mut add = |p: &Proc, why: &str| {
            let label = format!("{} (pid {}{})", p.name, p.pid, why);
            if !by.iter().any(|b| b.starts_with(&format!("{} (pid {}", p.name, p.pid))) {
                by.push(label);
            }
        };
        for p in &self.procs {
            if p.exe.as_deref().is_some_and(|e| safety::is_within(e, path)) {
                add(p, "");
            } else if p.cwd.as_deref().is_some_and(|c| safety::is_within(c, path)) {
                add(p, ", working folder");
            } else if tool_signal(p, path, kind_hint) {
                add(p, "");
            }
        }
        for (pid, f) in &self.open_files {
            if safety::is_within(f, path) {
                if let Some(p) = self.procs.iter().find(|p| p.pid == *pid) {
                    add(p, ", open file");
                }
            }
        }
        by.sort();
        by.truncate(5);
        ActiveUse { status: if by.is_empty() { InUseStatus::NotDetected } else { InUseStatus::InUse }, by, locked_files: 0, locked_bytes: 0 }
    }

    /// Processes working inside a project (for "active" build folders such as Rust `target`).
    pub fn working_in(&self, project: &Path) -> Vec<String> {
        self.procs
            .iter()
            .filter(|p| p.cwd.as_deref().is_some_and(|c| safety::is_within(c, project)))
            .map(|p| format!("{} (pid {})", p.name, p.pid))
            .take(5)
            .collect()
    }
}

/// Well-known tools that use a location without having their exe or working folder in it.
fn tool_signal(p: &Proc, path: &Path, kind: &str) -> bool {
    let cmd = p.cmd.to_lowercase();
    let name = p.name.to_lowercase();
    match kind {
        k if k.starts_with("gradle") => cmd.contains("gradledaemon") || cmd.contains("org.gradle.launcher"),
        "android-avd" => {
            let avd = path.file_name().map(|n| n.to_string_lossy().trim_end_matches(".avd").to_lowercase()).unwrap_or_default();
            (name.contains("emulator") || name.contains("qemu")) && !avd.is_empty() && (cmd.contains(&format!("-avd {avd}")) || cmd.contains(&format!("@{avd}")))
        }
        "xcode-simulators" => name == "launchd_sim" && cmd.contains(&path.to_string_lossy().to_lowercase()),
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn open_files(procs: &[Proc]) -> Vec<(u32, PathBuf)> {
    let mut out = vec![];
    for p in procs {
        let Ok(rd) = std::fs::read_dir(format!("/proc/{}/fd", p.pid)) else { continue };
        for e in rd.flatten() {
            if let Ok(t) = std::fs::read_link(e.path()) {
                if t.is_absolute() {
                    out.push((p.pid, t));
                }
            }
        }
    }
    out
}

#[cfg(not(target_os = "linux"))]
fn open_files(_: &[Proc]) -> Vec<(u32, PathBuf)> {
    vec![]
}

/// Files under `path` that another program holds open without sharing (Windows). Checks at most
/// `limit` files. Returns None where locks cannot be detected.
pub fn locked_files(path: &Path, limit: usize) -> Option<(u64, u64)> {
    imp_locked(path, limit)
}

#[cfg(windows)]
fn imp_locked(path: &Path, limit: usize) -> Option<(u64, u64)> {
    use std::os::windows::fs::OpenOptionsExt;
    let (mut n, mut bytes) = (0u64, 0u64);
    let files: Box<dyn Iterator<Item = PathBuf>> = if path.is_file() {
        Box::new(std::iter::once(path.to_path_buf()))
    } else {
        Box::new(walkdir::WalkDir::new(path).follow_links(false).into_iter().flatten().filter(|e| e.file_type().is_file()).map(|e| e.into_path()))
    };
    for f in files.take(limit) {
        // share_mode(0): fails with a sharing violation (32) when another process has it open.
        match std::fs::OpenOptions::new().read(true).share_mode(0).open(&f) {
            Err(e) if e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33) => {
                n += 1;
                bytes += std::fs::symlink_metadata(&f).map(|m| m.len()).unwrap_or(0);
            }
            _ => {}
        }
    }
    Some((n, bytes))
}

#[cfg(not(windows))]
fn imp_locked(_: &Path, _: usize) -> Option<(u64, u64)> {
    None
}

/// Merges a lock check into a process check.
pub fn with_locks(mut u: ActiveUse, locks: Option<(u64, u64)>) -> ActiveUse {
    if let Some((n, b)) = locks {
        u.locked_files = n;
        u.locked_bytes = b;
        if n > 0 {
            u.status = InUseStatus::InUse;
        }
    }
    u
}
