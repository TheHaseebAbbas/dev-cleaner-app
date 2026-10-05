//! Global (per-user) caches and SDK components: npm, Gradle, Android SDK, JetBrains, Xcode, ...
//!
//! Locations are resolved per OS (home folder, `%LOCALAPPDATA%`, the Android SDK root).

use crate::scanner::{dir_stats, dir_stats_parts, dir_stats_parts_raw, Level, Part, Warning};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalCache {
    pub id: String,
    pub name: String,
    pub category: String,
    pub path: String,
    pub exists: bool,
    pub disk_bytes: u64,
    pub file_count: u64,
    pub note: String,
    /// Independent sub-folders (e.g. one per Gradle version); empty when the cache is not split.
    pub parts: Vec<Part>,
    /// The folder itself must not be removed (only its parts), e.g. the Windows Temp folder.
    pub parts_only: bool,
    /// Shown for information only: it cannot be removed from here (e.g. Docker or WSL disk images).
    pub info_only: bool,
    /// Reasons to think twice before removing this (or any part of it).
    pub warnings: Vec<Warning>,
}

/// A place that is looked at, without measuring it (cheap; used by the "where it looks" dialog).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub category: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Clone, Copy)]
enum Base {
    Home,
    /// `%LOCALAPPDATA%` on Windows.
    LocalData,
    /// `%APPDATA%` (Roaming) on Windows.
    Data,
    AndroidSdk,
}

struct Def {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    /// "all", "unix" (linux or macos), "linux", "macos" or "windows".
    os: &'static str,
    base: Base,
    path: &'static str,
    note: &'static str,
    /// Offer each direct child folder as an independent optional part.
    split: bool,
    parts_only: bool,
    /// Only these direct children are offered (as parts); empty means every child.
    allow: &'static [&'static str],
    info_only: bool,
    warn: Option<(Level, &'static str)>,
}

impl Def {
    const fn only(mut self, names: &'static [&'static str]) -> Def {
        self.allow = names;
        self.split = true;
        self.parts_only = true;
        self
    }
    const fn info(mut self) -> Def {
        self.info_only = true;
        self
    }
    const fn warn(mut self, level: Level, msg: &'static str) -> Def {
        self.warn = Some((level, msg));
        self
    }
}

const fn d(id: &'static str, name: &'static str, category: &'static str, os: &'static str, base: Base, path: &'static str, note: &'static str, split: bool) -> Def {
    Def { id, name, category, os, base, path, note, split, parts_only: false, allow: &[], info_only: false, warn: None }
}

const fn parts_only(mut def: Def) -> Def {
    def.split = true;
    def.parts_only = true;
    def
}

use Base::{AndroidSdk, Data, Home, LocalData};
use Level::{Caution, Danger};

const SDK_NOTE: &str = "Part of the Android SDK. Re-download any version in Android Studio's SDK Manager (needs internet); only remove versions you no longer build against";

const VSCODE_CACHES: &[&str] = &["Cache", "CachedData", "CachedExtensionVSIXs", "CachedProfilesData", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "logs", "Crashpad"];

const DOCKER_NOTE: &str = "View only. This file holds ALL your images, containers and volumes, so it is never deleted from here. Free space with `docker system prune -a` (add --volumes only if you do not need volume data), then compact the disk (Docker Desktop: Settings > Resources > Disk image size, or `wsl --shutdown` and compact the .vhdx)";

const TABLE: &[Def] = &[
    // Node.js
    d("npm", "npm cache", "Node.js", "unix", Home, ".npm/_cacache", "Re-downloaded on demand", false),
    d("npm-win", "npm cache", "Node.js", "windows", LocalData, "npm-cache/_cacache", "Re-downloaded on demand", false),
    d("yarn", "Yarn cache", "Node.js", "linux", Home, ".cache/yarn", "Re-downloaded on demand", false),
    d("yarn-mac", "Yarn cache", "Node.js", "macos", Home, "Library/Caches/Yarn", "Re-downloaded on demand", false),
    d("yarn-win", "Yarn cache", "Node.js", "windows", LocalData, "Yarn/Cache", "Re-downloaded on demand", false),
    d("pnpm", "pnpm store", "Node.js", "linux", Home, ".local/share/pnpm/store", "Re-linked on next install", false),
    d("pnpm-mac", "pnpm store", "Node.js", "macos", Home, "Library/pnpm/store", "Re-linked on next install", false),
    d("pnpm-win", "pnpm store", "Node.js", "windows", LocalData, "pnpm/store", "Re-linked on next install", false),
    // Rust
    d("cargo-registry", "Cargo registry", "Rust", "all", Home, ".cargo/registry", "index, downloaded crates (cache) and unpacked sources (src); all re-downloaded on demand", true),
    d("rustup-toolchains", "Rust toolchains", "Rust", "all", Home, ".rustup/toolchains", "One folder per installed toolchain; keep the one you use (rustup show). rustup install brings one back", true).warn(Danger, "Your default toolchain is required by cargo and rustc. Removing it breaks Rust builds until you run rustup install again."),
    // Java / Gradle / Maven
    d("gradle-caches", "Gradle caches", "Android/Gradle", "all", Home, ".gradle/caches", "Re-downloaded; next build is slow. Parts are independent", true),
    d("gradle-wrapper", "Gradle distributions", "Android/Gradle", "all", Home, ".gradle/wrapper/dists", "One folder per Gradle version; the right one is re-downloaded when a project needs it", true).warn(Caution, "Projects that use one of these Gradle versions will download it again on their next build."),
    d("maven", "Maven repository", "Java", "all", Home, ".m2/repository", "Re-downloaded; next build is slow", false).warn(Caution, "Offline builds will fail until dependencies are downloaded again."),
    // Android SDK (location from ANDROID_HOME / ANDROID_SDK_ROOT, else the OS default; AppData on Windows)
    d("android-platforms", "Android SDK platforms", "Android SDK", "all", AndroidSdk, "platforms", SDK_NOTE, true).warn(Caution, "Android Studio and Gradle builds need the platform (API level) your app compiles against. Keep it if any project still targets it."),
    d("android-build-tools", "Android SDK build-tools", "Android SDK", "all", AndroidSdk, "build-tools", SDK_NOTE, true).warn(Caution, "Required to build and package Android apps. Keep the version your projects use."),
    d("android-ndk", "Android NDK", "Android SDK", "all", AndroidSdk, "ndk", SDK_NOTE, true).warn(Caution, "Required by projects with native (C/C++) code. Keep the version your projects pin."),
    d("android-cmake", "Android CMake", "Android SDK", "all", AndroidSdk, "cmake", SDK_NOTE, true),
    d("android-system-images", "Android emulator system images", "Android SDK", "all", AndroidSdk, "system-images", SDK_NOTE, true).warn(Caution, "Emulators using this image stop working until it is downloaded again."),
    d("android-sources", "Android SDK sources", "Android SDK", "all", AndroidSdk, "sources", SDK_NOTE, true),
    d("android-avd", "Android emulators (AVD)", "Android SDK", "all", Home, ".android/avd", "One folder per virtual device; its data is lost", true).warn(Danger, "Deleting a virtual device removes its apps and data permanently. It cannot be recreated automatically."),
    // Dart / Flutter
    d("pub-cache", "Dart pub cache", "Flutter/Dart", "unix", Home, ".pub-cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true),
    d("pub-cache-win", "Dart pub cache", "Flutter/Dart", "windows", LocalData, "Pub/Cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true),
    d("fvm-versions", "FVM Flutter SDKs", "Flutter/Dart", "unix", Home, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true).warn(Caution, "Projects pinned to this Flutter version will need it installed again."),
    d("fvm-versions-win", "FVM Flutter SDKs", "Flutter/Dart", "windows", LocalData, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true).warn(Caution, "Projects pinned to this Flutter version will need it installed again."),
    // Python, Go, .NET
    d("pip-linux", "pip cache", "Python", "linux", Home, ".cache/pip", "Re-downloaded on demand", false),
    d("pip-mac", "pip cache", "Python", "macos", Home, "Library/Caches/pip", "Re-downloaded on demand", false),
    d("pip-win", "pip cache", "Python", "windows", LocalData, "pip/Cache", "Re-downloaded on demand", false),
    d("conda-miniconda", "Conda package cache (miniconda)", "Python", "all", Home, "miniconda3/pkgs", "Re-downloaded on demand", false),
    d("conda-anaconda", "Conda package cache (anaconda)", "Python", "all", Home, "anaconda3/pkgs", "Re-downloaded on demand", false),
    d("go-build", "Go build cache", "Go", "linux", Home, ".cache/go-build", "Rebuilt on next build", false),
    d("go-build-win", "Go build cache", "Go", "windows", LocalData, "go-build", "Rebuilt on next build", false),
    d("nuget", "NuGet packages", ".NET", "all", Home, ".nuget/packages", "dotnet restore re-downloads; one folder per package", true),
    d("nuget-http-win", "NuGet HTTP cache", ".NET", "windows", LocalData, "NuGet/v3-cache", "Re-downloaded on demand", false),
    // IDE caches (settings live elsewhere and are not touched)
    d("jetbrains-win", "JetBrains IDE caches", "IDEs", "windows", LocalData, "JetBrains", "One folder per IDE version (caches, indexes, logs). Rebuilt on next start; settings are kept in AppData\\Roaming", true),
    d("jetbrains-mac", "JetBrains IDE caches", "IDEs", "macos", Home, "Library/Caches/JetBrains", "One folder per IDE version. Rebuilt on next start", true),
    d("jetbrains-linux", "JetBrains IDE caches", "IDEs", "linux", Home, ".cache/JetBrains", "One folder per IDE version. Rebuilt on next start", true),
    d("android-studio-win", "Android Studio caches", "IDEs", "windows", LocalData, "Google", "One folder per Android Studio version (caches, logs). Rebuilt on next start; settings are kept elsewhere", true),
    d("android-studio-mac", "Android Studio caches", "IDEs", "macos", Home, "Library/Caches/Google", "One folder per Android Studio version. Rebuilt on next start", true),
    d("android-studio-linux", "Android Studio caches", "IDEs", "linux", Home, ".cache/Google", "One folder per Android Studio version. Rebuilt on next start", true),
    // Apple
    d("deriveddata", "Xcode DerivedData", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/DerivedData", "One folder per project, rebuilt by Xcode", true),
    d("xcode-archives", "Xcode Archives", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/Archives", "Archives cannot be recreated; review each date first", true).warn(Danger, "Archives are your shipped builds and their debug symbols. They cannot be recreated; keep any you may need for crash symbolication or App Store re-submission."),
    d("ios-devicesupport", "iOS DeviceSupport", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/iOS DeviceSupport", "One folder per iOS version; recreated when a device is connected", true).warn(Caution, "Xcode will copy the support files again the next time you connect that iOS version (this takes a while)."),
    d("simulators", "CoreSimulator devices", "iOS/macOS", "macos", Home, "Library/Developer/CoreSimulator/Devices", "One folder per simulator; its data is lost", true).warn(Danger, "Deleting a simulator removes its installed apps and data permanently."),
    d("cocoapods", "CocoaPods cache", "iOS/macOS", "macos", Home, "Library/Caches/CocoaPods", "Re-downloaded on demand", false),
    d("homebrew", "Homebrew cache", "System", "macos", Home, "Library/Caches/Homebrew", "Re-downloaded on demand", false),
    // VS Code: only the cache folders, never your settings, extensions or unsaved-file backups
    d("vscode-caches-win", "VS Code caches", "IDEs", "windows", Data, "Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES),
    d("vscode-caches-mac", "VS Code caches", "IDEs", "macos", Home, "Library/Application Support/Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES),
    d("vscode-caches-linux", "VS Code caches", "IDEs", "linux", Home, ".config/Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES),
    // Docker: view only. Deleting the disk image wipes every image, container and volume.
    d("docker-win", "Docker Desktop disk", "Containers", "windows", LocalData, "Docker", DOCKER_NOTE, true).info(),
    d("docker-mac", "Docker Desktop disk", "Containers", "macos", Home, "Library/Containers/com.docker.docker/Data", DOCKER_NOTE, true).info(),
    d("docker-rootless", "Docker (rootless) data", "Containers", "linux", Home, ".local/share/docker", DOCKER_NOTE, true).info(),
    // Windows temp and AI tools
    parts_only(d("temp-win", "Windows user Temp", "System", "windows", LocalData, "Temp", "Leftover temporary files. Items in use by a running program cannot be removed and are reported as errors", true).warn(Caution, "Programs that are running may be using files in here; removing them can make those programs misbehave. Close your apps first.")),
    d("claude-versions", "Claude Code old versions", "AI tools", "all", Home, ".local/share/claude/versions", "One file per version; keep the one in use", false).warn(Danger, "One of these is the version currently in use. Removing it can break the claude command."),
];

/// Where the platform keeps things; separated from the OS so it can be unit-tested.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub os: String,
    pub home: Option<PathBuf>,
    pub local_data: Option<PathBuf>,
    pub data: Option<PathBuf>,
    /// Value of ANDROID_SDK_ROOT or ANDROID_HOME, if set.
    pub android_sdk_env: Option<PathBuf>,
}

impl Env {
    pub fn detect() -> Env {
        let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
        Env {
            os: std::env::consts::OS.into(),
            home: dirs::home_dir(),
            local_data: dirs::data_local_dir(),
            data: dirs::data_dir(),
            android_sdk_env: var("ANDROID_SDK_ROOT").or_else(|| var("ANDROID_HOME")),
        }
    }

    /// The Android SDK folder: the environment variable if set, otherwise the OS default
    /// (`%LOCALAPPDATA%\Android\Sdk`, `~/Library/Android/sdk`, `~/Android/Sdk`).
    pub fn android_sdk_root(&self) -> Option<PathBuf> {
        let default = match self.os.as_str() {
            "windows" => self.local_data.as_ref().map(|p| p.join("Android").join("Sdk")),
            "macos" => self.home.as_ref().map(|p| p.join("Library/Android/sdk")),
            _ => self.home.as_ref().map(|p| p.join("Android/Sdk")),
        };
        match (&self.android_sdk_env, default) {
            (Some(e), Some(d)) => Some(if e.is_dir() || !d.is_dir() { e.clone() } else { d }),
            (Some(e), None) => Some(e.clone()),
            (None, d) => d,
        }
    }

    fn resolve(&self, base: Base, rel: &str) -> Option<PathBuf> {
        let root = match base {
            Base::Home => self.home.clone(),
            Base::LocalData => self.local_data.clone(),
            Base::Data => self.data.clone(),
            Base::AndroidSdk => self.android_sdk_root(),
        }?;
        Some(root.join(rel))
    }
}

fn os_matches(def_os: &str, os: &str) -> bool {
    match def_os {
        "all" => true,
        "unix" => os == "linux" || os == "macos",
        other => other == os,
    }
}

fn defs_for(env: &Env) -> impl Iterator<Item = (&'static Def, PathBuf)> + '_ {
    TABLE
        .iter()
        .filter(|t| os_matches(t.os, &env.os))
        .filter_map(|t| env.resolve(t.base, t.path).map(|p| (t, p)))
}

/// Every place that is checked on this machine, without measuring anything.
pub fn locations_with(env: &Env) -> Vec<Location> {
    let mut v: Vec<Location> = defs_for(env)
        .map(|(t, p)| Location { id: t.id.into(), name: t.name.into(), category: t.category.into(), exists: p.is_dir(), path: p.to_string_lossy().into_owned() })
        .collect();
    if env.os == "windows" {
        if let Some(l) = env.local_data.as_ref() {
            let p = l.join("Packages");
            v.push(Location { id: "wsl-distros-win".into(), name: "WSL Linux distributions".into(), category: "Containers".into(), exists: p.is_dir(), path: p.to_string_lossy().into_owned() });
        }
    }
    v
}

pub fn locations() -> Vec<Location> {
    locations_with(&Env::detect())
}

pub fn list_global_caches() -> Vec<GlobalCache> {
    list_global_caches_with(&Env::detect())
}

/// The default toolchain named in `~/.rustup/settings.toml`, e.g. `stable-x86_64-pc-windows-msvc`.
fn rustup_default(env: &Env) -> Option<String> {
    let text = std::fs::read_to_string(env.home.as_ref()?.join(".rustup/settings.toml")).ok()?;
    text.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == "default_toolchain").then(|| v.trim().trim_matches('"').to_string())
    })
}

/// Windows Store WSL distributions: each one is a single .vhdx holding a whole Linux filesystem.
fn wsl_distros(env: &Env) -> Option<GlobalCache> {
    if env.os != "windows" {
        return None;
    }
    let packages = env.local_data.as_ref()?.join("Packages");
    let mut parts = vec![];
    if let Ok(rd) = std::fs::read_dir(&packages) {
        for e in rd.flatten() {
            let vhdx = e.path().join("LocalState").join("ext4.vhdx");
            if let Ok(md) = std::fs::metadata(&vhdx) {
                parts.push(Part {
                    path: vhdx.to_string_lossy().into_owned(),
                    name: e.file_name().to_string_lossy().into_owned(),
                    disk_bytes: md.len(),
                    apparent_bytes: md.len(),
                    file_count: 1,
                    last_modified: md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
                    warning: None,
                });
            }
        }
    }
    parts.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    let total: u64 = parts.iter().map(|p| p.disk_bytes).sum();
    Some(GlobalCache {
        id: "wsl-distros-win".into(),
        name: "WSL Linux distributions".into(),
        category: "Containers".into(),
        path: packages.to_string_lossy().into_owned(),
        exists: !parts.is_empty(),
        disk_bytes: total,
        file_count: parts.len() as u64,
        note: "View only. Each .vhdx is an entire Linux system with all its files; it is never deleted from here. To shrink one: `wsl --shutdown`, then compact the .vhdx (Optimize-VHD or diskpart). To remove a distribution you no longer use: `wsl --unregister <name>`".into(),
        parts,
        parts_only: true,
        info_only: true,
        warnings: vec![],
    })
}

fn measure(t: &Def, path: PathBuf, env: &Env) -> GlobalCache {
    let exists = path.is_dir();
    let (st, mut parts) = match (exists, t.split, t.allow.is_empty()) {
        (false, _, _) => Default::default(),
        (true, true, true) => dir_stats_parts(&path),
        (true, true, false) => {
            let (_, all) = dir_stats_parts_raw(&path);
            let kept: Vec<Part> = all.into_iter().filter(|p| t.allow.contains(&p.name.as_str())).collect();
            let mut st = crate::scanner::DirStats::default();
            for p in &kept {
                st.disk_bytes += p.disk_bytes;
                st.files += p.file_count;
            }
            (st, kept)
        }
        (true, false, _) => (dir_stats(&path), vec![]),
    };
    if t.id == "rustup-toolchains" {
        if let Some(def) = rustup_default(env) {
            for p in parts.iter_mut().filter(|p| def.starts_with(p.name.as_str()) || p.name.starts_with(&def)) {
                p.warning = Some(Warning::danger(format!("{} is your default toolchain. Removing it breaks cargo and rustc until you reinstall it.", p.name)));
            }
        }
    }
    GlobalCache {
        id: t.id.into(),
        name: t.name.into(),
        category: t.category.into(),
        path: path.to_string_lossy().into_owned(),
        exists,
        disk_bytes: st.disk_bytes,
        file_count: st.files,
        note: t.note.into(),
        parts,
        parts_only: t.parts_only,
        info_only: t.info_only,
        warnings: t.warn.map(|(level, m)| Warning { level, message: m.into() }).into_iter().collect(),
    }
}

/// Progress of the global scan: `done` of `total` locations checked, `current` is the one just finished.
#[derive(Debug, Clone, Serialize)]
pub struct GlobalProgress {
    pub done: u64,
    pub total: u64,
    pub current: String,
}

/// Measures every known location in parallel, calling `on_item` for each one that exists and
/// `on_progress` after every location (found or not).
pub fn scan_global_caches<F, P>(env: &Env, cancel: &std::sync::atomic::AtomicBool, on_item: F, on_progress: P) -> Vec<GlobalCache>
where
    F: Fn(&GlobalCache) + Sync,
    P: Fn(GlobalProgress) + Sync,
{
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    let defs: Vec<(&Def, PathBuf)> = defs_for(env).collect();
    let total = defs.len() as u64 + u64::from(env.os == "windows");
    let done = AtomicU64::new(0);
    let mut out: Vec<GlobalCache> = defs
        .into_par_iter()
        .filter_map(|(t, path)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let c = measure(t, path, env);
            if c.exists {
                on_item(&c);
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(GlobalProgress { done: n, total, current: c.name.clone() });
            c.exists.then_some(c)
        })
        .collect();
    if !cancel.load(Ordering::Relaxed) {
        if let Some(w) = wsl_distros(env) {
            on_item(&w);
            on_progress(GlobalProgress { done: total, total, current: w.name.clone() });
            if w.exists {
                out.push(w);
            }
        }
    }
    out.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    out
}

pub fn list_global_caches_with(env: &Env) -> Vec<GlobalCache> {
    scan_global_caches(env, &std::sync::atomic::AtomicBool::new(false), |_| {}, |_| {})
}
