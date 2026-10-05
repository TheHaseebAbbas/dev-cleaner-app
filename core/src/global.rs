//! Global (per-user) caches, SDKs, toolchains and developer state: npm, Gradle, Android SDK,
//! JetBrains, Xcode, ...
//!
//! Locations are data-driven: each entry says what it is (category), how risky it is to remove,
//! what recovering it costs, and how it may be cleaned (whole, part by part, or view only).
//! Locations are resolved per OS (home folder, `%LOCALAPPDATA%`, the Android SDK root).

use crate::inuse::{self, ActiveUse, Snapshot};
use crate::model::{Block, BlockSource, Category, Confidence, Cost, Fingerprint, GitStatus, Level, Recommendation, Risk, Usage, Verdict, Warning};
use crate::recommend::{self, Facts};
use crate::references::Refs;
use crate::safety;
use crate::scanner::{idle, id_for, now_secs, parts_measure, sensitive_policy, DirStats, Part};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalCache {
    pub id: String,
    #[serde(default)]
    pub scan_id: String,
    pub name: String,
    /// Tool or ecosystem, e.g. "Android SDK".
    pub ecosystem: String,
    pub category: Category,
    /// Section on the Tools & SDKs screen.
    pub group: String,
    pub path: String,
    pub exists: bool,
    pub disk_bytes: u64,
    pub apparent_bytes: u64,
    pub reclaimable_bytes: u64,
    pub file_count: u64,
    /// Newest modification time inside (unix seconds).
    pub last_modified: u64,
    pub note: String,
    /// What happens if it is removed.
    pub consequence: String,
    /// How to get it back.
    pub regenerates_with: String,
    /// Independent sub-folders (e.g. one per Gradle version); empty when the cache is not split.
    pub parts: Vec<Part>,
    /// The folder itself must not be removed (only its parts), e.g. the Windows Temp folder.
    pub parts_only: bool,
    /// Shown for information only: it cannot be removed from here (e.g. Docker or WSL disk images).
    pub info_only: bool,
    /// Reasons to think twice before removing this (or any part of it).
    pub warnings: Vec<Warning>,
    pub risk: Risk,
    pub rebuild_cost: Cost,
    pub network_cost: Cost,
    pub download_bytes: u64,
    pub block: Option<Block>,
    pub recommendation: Recommendation,
    /// True when parts were checked against the projects from the last project scan.
    pub references_checked: bool,
    pub fingerprint: Fingerprint,
    /// Running processes or locked files (when active-use detection is on).
    #[serde(default)]
    pub in_use: Option<ActiveUse>,
}

/// A place that is looked at, without measuring it (cheap; used by the "where it looks" dialog).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub ecosystem: String,
    pub group: String,
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
    eco: &'static str,
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
    /// Only children whose names start with one of these are offered.
    allow_prefix: &'static [&'static str],
    /// Children that are listed but can never be removed, with the reason.
    deny: &'static [(&'static str, &'static str)],
    /// Offer direct child files as parts too.
    file_parts: bool,
    info_only: bool,
    warn: Option<(Level, &'static str)>,
    cat: Category,
    risk: Risk,
    rebuild: Cost,
    net: Cost,
    consequence: &'static str,
    recovery: &'static str,
}

impl Def {
    const fn only(mut self, names: &'static [&'static str]) -> Def {
        self.allow = names;
        self.split = true;
        self.parts_only = true;
        self
    }
    const fn prefix(mut self, names: &'static [&'static str]) -> Def {
        self.allow_prefix = names;
        self.split = true;
        self.parts_only = true;
        self
    }
    const fn deny(mut self, d: &'static [(&'static str, &'static str)]) -> Def {
        self.deny = d;
        self
    }
    const fn parts(mut self) -> Def {
        self.split = true;
        self.parts_only = true;
        self
    }
    const fn files(mut self) -> Def {
        self.file_parts = true;
        self
    }
    const fn info(mut self) -> Def {
        self.info_only = true;
        self.risk = Risk::Blocked;
        self.cat = Category::SystemData;
        self
    }
    const fn warn(mut self, level: Level, msg: &'static str) -> Def {
        self.warn = Some((level, msg));
        self
    }
    const fn class(mut self, cat: Category, risk: Risk, rebuild: Cost, net: Cost) -> Def {
        self.cat = cat;
        self.risk = risk;
        self.rebuild = rebuild;
        self.net = net;
        self
    }
    const fn says(mut self, consequence: &'static str, recovery: &'static str) -> Def {
        self.consequence = consequence;
        self.recovery = recovery;
        self
    }
}

const fn d(id: &'static str, name: &'static str, eco: &'static str, os: &'static str, base: Base, path: &'static str, note: &'static str, split: bool) -> Def {
    Def {
        id, name, eco, os, base, path, note, split, parts_only: false, allow: &[], allow_prefix: &[], deny: &[], file_parts: false, info_only: false, warn: None,
        cat: Category::PackageCache, risk: Risk::Safe, rebuild: Cost::Low, net: Cost::Medium,
        consequence: "Tools download or rebuild what they need the next time you use them.", recovery: "used again automatically",
    }
}

use Base::{AndroidSdk, Data, Home, LocalData};
use Category::{Archive, BuildArtifact, DeviceData, IdeCache, PackageCache, Sdk, TempData, ToolCache, Toolchain};
use Cost::{High, Low, Medium, None as Free, VeryHigh};
use Level::{Caution, Danger};
use Risk::{Caution as Review, Critical, Danger as Risky, Safe};

const SDK_NOTE: &str = "Part of the Android SDK. Re-download any version in Android Studio's SDK Manager (needs internet); only remove versions you no longer build against";
const SDK_CONSEQ: &str = "Projects that build against this version stop building until you install it again in Android Studio's SDK Manager.";
const SDK_RECOVERY: &str = "Android Studio > SDK Manager";

const VSCODE_CACHES: &[&str] = &["Cache", "CachedData", "CachedExtensionVSIXs", "CachedProfilesData", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "logs", "Crashpad"];

const DOCKER_NOTE: &str = "View only. This file holds ALL your images, containers and volumes, so it is never deleted from here. Free space with `docker system prune -a` (add --volumes only if you do not need volume data), then compact the disk (Docker Desktop: Settings > Resources > Disk image size, or `wsl --shutdown` and compact the .vhdx)";
const PKG_CONSEQ: &str = "Packages are downloaded again the next time a project needs them.";
const IDE_CONSEQ: &str = "The IDE rebuilds its caches and indexes on next start, which takes a while. Settings are kept.";

#[rustfmt::skip]
const TABLE: &[Def] = &[
    // Node.js
    d("npm", "npm cache", "Node.js", "unix", Home, ".npm/_cacache", "Re-downloaded on demand", false).says(PKG_CONSEQ, "npm install"),
    d("npm-win", "npm cache", "Node.js", "windows", LocalData, "npm-cache/_cacache", "Re-downloaded on demand", false).says(PKG_CONSEQ, "npm install"),
    d("yarn", "Yarn cache", "Node.js", "linux", Home, ".cache/yarn", "Re-downloaded on demand", false).says(PKG_CONSEQ, "yarn install"),
    d("yarn-mac", "Yarn cache", "Node.js", "macos", Home, "Library/Caches/Yarn", "Re-downloaded on demand", false).says(PKG_CONSEQ, "yarn install"),
    d("yarn-win", "Yarn cache", "Node.js", "windows", LocalData, "Yarn/Cache", "Re-downloaded on demand", false).says(PKG_CONSEQ, "yarn install"),
    d("pnpm", "pnpm store", "Node.js", "linux", Home, ".local/share/pnpm/store", "Re-linked on next install", false).class(PackageCache, Review, Medium, Medium).says("Existing node_modules keep working (they hold hard links); new installs download packages again.", "pnpm install"),
    d("pnpm-mac", "pnpm store", "Node.js", "macos", Home, "Library/pnpm/store", "Re-linked on next install", false).class(PackageCache, Review, Medium, Medium).says("Existing node_modules keep working (they hold hard links); new installs download packages again.", "pnpm install"),
    d("pnpm-win", "pnpm store", "Node.js", "windows", LocalData, "pnpm/store", "Re-linked on next install", false).class(PackageCache, Review, Medium, Medium).says("Existing node_modules keep working (they hold hard links); new installs download packages again.", "pnpm install"),
    // Rust
    d("cargo-registry", "Cargo registry", "Rust", "all", Home, ".cargo/registry", "index, downloaded crates (cache) and unpacked sources (src); all re-downloaded on demand", true).class(PackageCache, Review, Medium, High).says("Cargo downloads the crate index and every crate again on the next build.", "cargo fetch / cargo build"),
    d("rustup-toolchains", "Rust toolchains", "Rust", "all", Home, ".rustup/toolchains", "One folder per installed toolchain. rustup install brings one back", true).parts().class(Toolchain, Risky, High, High).says("Projects that use this toolchain stop building until it is installed again.", "rustup toolchain install <name>"),
    // Java / Gradle / Maven
    d("gradle-caches", "Gradle caches", "Android/Gradle", "all", Home, ".gradle/caches", "Re-downloaded; next build is slow. Parts are independent", true).class(PackageCache, Review, High, High).says("Future Gradle builds download dependencies again and are slow the first time.", "gradle build"),
    d("gradle-wrapper", "Gradle distributions", "Android/Gradle", "all", Home, ".gradle/wrapper/dists", "One folder per Gradle version; the right one is re-downloaded when a project needs it", true).parts().class(Toolchain, Review, Low, Medium).says("Projects that use this Gradle version download it again on their next build.", "./gradlew (downloads it)"),
    d("maven", "Maven repository", "Java", "all", Home, ".m2/repository", "Re-downloaded; next build is slow", false).class(PackageCache, Review, High, High).says("Every Maven build downloads its dependencies again; offline builds fail until then.", "mvn dependency:resolve"),
    // Android SDK (location from ANDROID_HOME / ANDROID_SDK_ROOT, else the OS default; AppData on Windows)
    d("android-platforms", "Android SDK platforms", "Android SDK", "all", AndroidSdk, "platforms", SDK_NOTE, true).parts().class(Sdk, Risky, High, High).says(SDK_CONSEQ, SDK_RECOVERY),
    d("android-build-tools", "Android SDK build-tools", "Android SDK", "all", AndroidSdk, "build-tools", SDK_NOTE, true).parts().class(Sdk, Risky, High, High).says(SDK_CONSEQ, SDK_RECOVERY),
    d("android-ndk", "Android NDK", "Android SDK", "all", AndroidSdk, "ndk", SDK_NOTE, true).parts().class(Sdk, Risky, High, VeryHigh).says("Projects with native (C/C++) code stop building until this NDK is installed again.", SDK_RECOVERY),
    d("android-cmake", "Android CMake", "Android SDK", "all", AndroidSdk, "cmake", SDK_NOTE, true).parts().class(Sdk, Review, Medium, Medium).says("Native builds that use this CMake version download it again.", SDK_RECOVERY),
    d("android-system-images", "Android emulator system images", "Android SDK", "all", AndroidSdk, "system-images", SDK_NOTE, true).parts().class(Sdk, Risky, High, VeryHigh).warn(Caution, "Emulators using this image stop working until it is downloaded again.").says("Emulators that use this image stop starting until it is downloaded again.", SDK_RECOVERY),
    d("android-sources", "Android SDK sources", "Android SDK", "all", AndroidSdk, "sources", SDK_NOTE, true).class(Sdk, Safe, Low, Medium).says("Android Studio can no longer show framework source code until you download it again.", SDK_RECOVERY),
    d("android-avd", "Android emulators (AVD)", "Android SDK", "all", Home, ".android/avd", "One folder per virtual device; its apps and data are lost", true).parts().class(DeviceData, Critical, VeryHigh, Free).warn(Danger, "Deleting a virtual device removes its installed apps, settings and data permanently. It cannot be recreated automatically.").says("The emulator and the apps, settings and data inside it are removed. You would have to create a new device.", "Android Studio > Device Manager > Create device"),
    // Dart / Flutter
    d("pub-cache", "Dart pub cache", "Flutter/Dart", "unix", Home, ".pub-cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true).class(PackageCache, Review, Medium, Medium).says("Packages are downloaded again by `flutter pub get`. Globally activated Dart tools (bin) must be activated again.", "flutter pub get"),
    d("pub-cache-win", "Dart pub cache", "Flutter/Dart", "windows", LocalData, "Pub/Cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true).class(PackageCache, Review, Medium, Medium).says("Packages are downloaded again by `flutter pub get`. Globally activated Dart tools (bin) must be activated again.", "flutter pub get"),
    d("fvm-versions", "FVM Flutter SDKs", "Flutter/Dart", "unix", Home, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true).parts().class(Sdk, Review, High, VeryHigh).says("Projects pinned to this Flutter version need it installed again.", "fvm install <version>"),
    d("fvm-versions-win", "FVM Flutter SDKs", "Flutter/Dart", "windows", LocalData, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true).parts().class(Sdk, Review, High, VeryHigh).says("Projects pinned to this Flutter version need it installed again.", "fvm install <version>"),
    // Python, Go, .NET
    d("pip-linux", "pip cache", "Python", "linux", Home, ".cache/pip", "Re-downloaded on demand", false).says(PKG_CONSEQ, "pip install"),
    d("pip-mac", "pip cache", "Python", "macos", Home, "Library/Caches/pip", "Re-downloaded on demand", false).says(PKG_CONSEQ, "pip install"),
    d("pip-win", "pip cache", "Python", "windows", LocalData, "pip/Cache", "Re-downloaded on demand", false).says(PKG_CONSEQ, "pip install"),
    d("conda-miniconda", "Conda package cache (miniconda)", "Python", "all", Home, "miniconda3/pkgs", "Re-downloaded on demand", false).class(PackageCache, Review, Medium, High).says("Conda downloads packages again when you create or update environments.", "conda install"),
    d("conda-anaconda", "Conda package cache (anaconda)", "Python", "all", Home, "anaconda3/pkgs", "Re-downloaded on demand", false).class(PackageCache, Review, Medium, High).says("Conda downloads packages again when you create or update environments.", "conda install"),
    d("go-build", "Go build cache", "Go", "linux", Home, ".cache/go-build", "Rebuilt on next build", false).class(ToolCache, Safe, Medium, Free).says("Go rebuilds packages on the next build, which is slower the first time.", "go build"),
    d("go-build-win", "Go build cache", "Go", "windows", LocalData, "go-build", "Rebuilt on next build", false).class(ToolCache, Safe, Medium, Free).says("Go rebuilds packages on the next build, which is slower the first time.", "go build"),
    d("nuget", "NuGet packages", ".NET", "all", Home, ".nuget/packages", "dotnet restore re-downloads; one folder per package", true).class(PackageCache, Review, Medium, High).says("`dotnet restore` downloads packages again.", "dotnet restore"),
    d("nuget-http-win", "NuGet HTTP cache", ".NET", "windows", LocalData, "NuGet/v3-cache", "Re-downloaded on demand", false).says(PKG_CONSEQ, "dotnet restore"),
    // IDE caches (settings live elsewhere and are not touched)
    d("jetbrains-win", "JetBrains IDE caches", "IDEs", "windows", LocalData, "JetBrains", "One folder per IDE version (caches, indexes, logs). Rebuilt on next start; settings are kept in AppData\\Roaming", true).parts().deny(&[("Toolbox", "JetBrains Toolbox keeps installed IDEs here.")]).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen the IDE"),
    d("jetbrains-mac", "JetBrains IDE caches", "IDEs", "macos", Home, "Library/Caches/JetBrains", "One folder per IDE version. Rebuilt on next start", true).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen the IDE"),
    d("jetbrains-linux", "JetBrains IDE caches", "IDEs", "linux", Home, ".cache/JetBrains", "One folder per IDE version. Rebuilt on next start", true).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen the IDE"),
    d("android-studio-win", "Android Studio caches", "IDEs", "windows", LocalData, "Google", "One folder per Android Studio version (caches, logs). Only Android Studio folders are offered; Chrome and other Google apps are not touched", true).prefix(&["AndroidStudio"]).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen Android Studio"),
    d("android-studio-mac", "Android Studio caches", "IDEs", "macos", Home, "Library/Caches/Google", "One folder per Android Studio version. Only Android Studio folders are offered", true).prefix(&["AndroidStudio"]).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen Android Studio"),
    d("android-studio-linux", "Android Studio caches", "IDEs", "linux", Home, ".cache/Google", "One folder per Android Studio version. Only Android Studio folders are offered", true).prefix(&["AndroidStudio"]).class(IdeCache, Safe, Medium, Free).says(IDE_CONSEQ, "reopen Android Studio"),
    // Apple
    d("deriveddata", "Xcode DerivedData", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/DerivedData", "One folder per project, rebuilt by Xcode", true).class(BuildArtifact, Safe, Medium, Free).says("Xcode rebuilds and re-indexes projects the next time you open them.", "build in Xcode"),
    d("xcode-archives", "Xcode Archives", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/Archives", "Archives cannot be recreated; review each date first", true).parts().class(Archive, Critical, VeryHigh, Free).warn(Danger, "Archives are your shipped builds and their debug symbols. They cannot be recreated; keep any you may need for crash symbolication or App Store re-submission.").says("The shipped builds and their debug symbols (dSYMs) are gone; crash reports from those versions can no longer be symbolicated.", "cannot be recreated"),
    d("ios-devicesupport", "iOS DeviceSupport", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/iOS DeviceSupport", "One folder per iOS version; recreated when a device is connected", true).parts().class(Sdk, Risky, Medium, Medium).warn(Caution, "Xcode will copy the support files again the next time you connect that iOS version (this takes a while).").says("Xcode copies the support files again the next time you connect a device with this iOS version.", "connect the device"),
    d("simulators", "CoreSimulator devices", "iOS/macOS", "macos", Home, "Library/Developer/CoreSimulator/Devices", "One folder per simulator; its apps and data are lost", true).parts().class(DeviceData, Critical, VeryHigh, Free).warn(Danger, "Deleting a simulator removes its installed apps and data permanently.").says("The simulator and the apps and data inside it are removed.", "Xcode > Devices and Simulators"),
    d("cocoapods", "CocoaPods cache", "iOS/macOS", "macos", Home, "Library/Caches/CocoaPods", "Re-downloaded on demand", false).says(PKG_CONSEQ, "pod install"),
    d("homebrew", "Homebrew cache", "System", "macos", Home, "Library/Caches/Homebrew", "Re-downloaded on demand", false).says("Homebrew downloads packages again when you install or upgrade.", "brew install"),
    // VS Code: only the cache folders, never your settings, extensions or unsaved-file backups
    d("vscode-caches-win", "VS Code caches", "IDEs", "windows", Data, "Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES).class(IdeCache, Safe, Low, Free).says("VS Code rebuilds these caches on next start.", "reopen VS Code"),
    d("vscode-caches-mac", "VS Code caches", "IDEs", "macos", Home, "Library/Application Support/Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES).class(IdeCache, Safe, Low, Free).says("VS Code rebuilds these caches on next start.", "reopen VS Code"),
    d("vscode-caches-linux", "VS Code caches", "IDEs", "linux", Home, ".config/Code", "Only cache and log folders are offered. User settings, snippets, keybindings and unsaved-file backups are not listed", true).only(VSCODE_CACHES).class(IdeCache, Safe, Low, Free).says("VS Code rebuilds these caches on next start.", "reopen VS Code"),
    // Docker: view only. Deleting the disk image wipes every image, container and volume.
    d("docker-win", "Docker Desktop disk", "Containers", "windows", LocalData, "Docker", DOCKER_NOTE, true).info(),
    d("docker-mac", "Docker Desktop disk", "Containers", "macos", Home, "Library/Containers/com.docker.docker/Data", DOCKER_NOTE, true).info(),
    d("docker-rootless", "Docker (rootless) data", "Containers", "linux", Home, ".local/share/docker", DOCKER_NOTE, true).info(),
    // Windows temp and AI tools
    d("temp-win", "Windows user Temp", "System", "windows", LocalData, "Temp", "Leftover temporary files. Only items unchanged for 7 days are offered; locked items are reported as errors", true).parts().files().class(TempData, Risky, Free, Free).warn(Caution, "Programs that are running may be using files in here; removing them can make those programs misbehave. Close your apps first.").says("Programs that still use these files may misbehave.", "not needed"),
    d("claude-versions", "Claude Code versions", "AI tools", "all", Home, ".local/share/claude/versions", "One file per installed version. The version in use is never offered", true).parts().files().class(Toolchain, Review, Low, Medium).says("Only old versions are offered; the claude command keeps using the active one.", "claude update"),
];

/// Temp entries changed more recently than this are not offered.
pub const TEMP_STALE_DAYS: u64 = 7;

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
    TABLE.iter().filter(|t| os_matches(t.os, &env.os)).filter_map(|t| env.resolve(t.base, t.path).map(|p| (t, p)))
}

/// Every place that is checked on this machine, without measuring anything.
pub fn locations_with(env: &Env) -> Vec<Location> {
    let mut v: Vec<Location> = defs_for(env)
        .map(|(t, p)| Location { id: t.id.into(), name: t.name.into(), ecosystem: t.eco.into(), group: t.cat.group().into(), exists: p.is_dir(), path: p.to_string_lossy().into_owned() })
        .collect();
    if env.os == "windows" {
        if let Some(l) = env.local_data.as_ref() {
            let p = l.join("Packages");
            v.push(Location { id: "wsl-distros-win".into(), name: "WSL Linux distributions".into(), ecosystem: "Containers".into(), group: Category::SystemData.group().into(), exists: p.is_dir(), path: p.to_string_lossy().into_owned() });
        }
    }
    v
}

pub fn locations() -> Vec<Location> {
    locations_with(&Env::detect())
}

/// What the global scan needs to know besides where to look.
#[derive(Debug, Clone, Default)]
pub struct GlobalContext {
    pub scan_id: String,
    pub protected_paths: Vec<PathBuf>,
    /// References from the last complete project scan; `None` when there was none.
    pub refs: Option<Refs>,
    pub detect_sensitive_files: bool,
    pub min_confidence: Option<Confidence>,
    /// Check running processes (and locked files on Windows) before recommending anything.
    pub detect_active_usage: bool,
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

/// The Claude Code version file the `claude` command points at, if it can be told.
fn claude_active(env: &Env) -> Option<PathBuf> {
    let home = env.home.as_ref()?;
    for link in [home.join(".local/bin/claude"), home.join(".local/bin/claude.exe")] {
        if let Ok(t) = std::fs::read_link(&link) {
            let t = if t.is_absolute() { t } else { link.parent()?.join(t) };
            return Some(safety::normalize(&t));
        }
    }
    None
}

/// Windows Store WSL distributions: each one is a single .vhdx holding a whole Linux filesystem.
fn wsl_distros(env: &Env, scan_id: &str) -> Option<GlobalCache> {
    if env.os != "windows" {
        return None;
    }
    let packages = env.local_data.as_ref()?.join("Packages");
    let mut parts = vec![];
    if let Ok(rd) = std::fs::read_dir(&packages) {
        for e in rd.flatten() {
            let vhdx = e.path().join("LocalState").join("ext4.vhdx");
            if let Ok(md) = std::fs::metadata(&vhdx) {
                let ps = vhdx.to_string_lossy().into_owned();
                parts.push(Part {
                    id: id_for(&ps),
                    path: ps,
                    name: e.file_name().to_string_lossy().into_owned(),
                    disk_bytes: md.len(),
                    apparent_bytes: md.len(),
                    reclaimable_bytes: 0,
                    file_count: 1,
                    last_modified: safety::mtime_secs(&md),
                    warning: None,
                    block: Some(Block::new(BlockSource::Rule, "A whole Linux system. Use `wsl --unregister` to remove a distribution.")),
                    risk: Some(Risk::Blocked),
                    usage: None,
                    recommendation: None,
                    is_file: true,
                    fingerprint: Fingerprint::default(),
                    in_use: None,
                    activity: None,
                });
            }
        }
    }
    parts.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    let total: u64 = parts.iter().map(|p| p.disk_bytes).sum();
    let block = Block::new(BlockSource::Rule, "View only: a WSL disk is an entire Linux environment, not a cache.");
    Some(GlobalCache {
        id: "wsl-distros-win".into(),
        scan_id: scan_id.into(),
        name: "WSL Linux distributions".into(),
        ecosystem: "Containers".into(),
        category: Category::SystemData,
        group: Category::SystemData.group().into(),
        path: packages.to_string_lossy().into_owned(),
        exists: !parts.is_empty(),
        disk_bytes: total,
        apparent_bytes: total,
        reclaimable_bytes: 0,
        file_count: parts.len() as u64,
        last_modified: parts.iter().map(|p| p.last_modified).max().unwrap_or(0),
        note: "View only. Each .vhdx is an entire Linux system with all its files; it is never deleted from here. To shrink one: `wsl --shutdown`, then compact the .vhdx (Optimize-VHD or diskpart). To remove a distribution you no longer use: `wsl --unregister <name>`".into(),
        consequence: "Not removable from Dev Cleaner.".into(),
        regenerates_with: "wsl --install".into(),
        parts,
        parts_only: true,
        info_only: true,
        warnings: vec![],
        risk: Risk::Blocked,
        rebuild_cost: Cost::VeryHigh,
        network_cost: Cost::VeryHigh,
        download_bytes: 0,
        recommendation: Recommendation { verdict: Verdict::Blocked, score: 0, reasons: vec![crate::model::Reason::no(block.reason.clone())] },
        block: Some(block),
        references_checked: false,
        in_use: None,
        fingerprint: Fingerprint::default(),
    })
}

fn download(cat: Category, net: Cost, bytes: u64) -> u64 {
    if net >= Cost::Medium && net != Cost::Unknown { (bytes as f64 * cat.download_factor()) as u64 } else { 0 }
}

fn measure(t: &Def, path: PathBuf, env: &Env, ctx: &GlobalContext, snap: Option<&Snapshot>) -> GlobalCache {
    let exists = path.is_dir();
    let now = now_secs();
    let filtered = !t.allow.is_empty() || !t.allow_prefix.is_empty();
    let (st, mut parts, sensitive, sensitive_count) = if !exists {
        (DirStats::default(), vec![], vec![], 0)
    } else {
        let (st, mut parts, s, n, _) = parts_measure(&path, t.file_parts, ctx.detect_sensitive_files);
        if filtered {
            parts.retain(|p| t.allow.contains(&p.name.as_str()) || t.allow_prefix.iter().any(|x| p.name.starts_with(x)));
            let mut kept = DirStats::default();
            for p in &parts {
                kept.disk_bytes += p.disk_bytes;
                kept.apparent_bytes += p.apparent_bytes;
                kept.reclaimable_bytes += p.reclaimable_bytes;
                kept.files += p.file_count;
                kept.newest = kept.newest.max(p.last_modified);
            }
            (kept, parts, vec![], 0)
        } else {
            if !t.split || (!t.parts_only && parts.len() < 2) {
                parts.clear();
            }
            (st, parts, s, n)
        }
    };

    let mut warnings: Vec<Warning> = t.warn.map(|(level, m)| Warning { level, message: m.into() }).into_iter().collect();
    let mut block = None;
    if t.info_only {
        block = Some(Block::new(BlockSource::Rule, "View only: Dev Cleaner shows this location but never deletes it."));
    } else if let Some(b) = safety::system_block(&path) {
        block = Some(b);
    } else if let Some(p) = safety::within_any(&path, &ctx.protected_paths) {
        block = Some(Block::new(BlockSource::User, format!("Inside your protected path {}.", p.display())));
    } else if let Some(kind) = exists.then(|| safety::redirection(&path)).flatten() {
        block = Some(Block::new(BlockSource::System, format!("This is a {kind}. Dev Cleaner never deletes through links or mounted folders.")));
    }
    let (sblock, swarn, critical) = sensitive_policy(t.cat, &sensitive, sensitive_count, &path);
    warnings.extend(swarn);
    if block.is_none() {
        block = sblock;
    }
    let mut risk = if critical { t.risk.max(Risk::Critical) } else { t.risk };
    if block.is_some() {
        risk = Risk::Blocked;
    }
    let check_use = |p: &Path| -> Option<ActiveUse> {
        if !ctx.detect_active_usage || !exists || t.info_only {
            return None;
        }
        let u = snap.map(|s| s.check(p, t.id)).unwrap_or_else(ActiveUse::unknown);
        // Temp folders: programs hold their files open without running from them.
        Some(if t.id == "temp-win" { inuse::with_locks(u, inuse::locked_files(p, 200)) } else { u })
    };
    let in_use = if t.parts_only { None } else { check_use(&path) };
    if let Some(u) = in_use.as_ref().filter(|u| u.in_use()) {
        warnings.push(Warning::danger(format!("{}. Close it before cleaning; files may be locked or recreated while it runs.", u.describe())));
    }

    // Per-part context: protection, the version in use, references, staleness.
    let default_tc = (t.id == "rustup-toolchains").then(|| rustup_default(env)).flatten();
    let claude = (t.id == "claude-versions").then(|| claude_active(env)).flatten();
    let newest_part = parts.iter().max_by_key(|p| p.last_modified).map(|p| p.path.clone());
    let refs = ctx.refs.as_ref();
    let mut references_checked = false;
    let min_conf = ctx.min_confidence.unwrap_or(Confidence::High);
    for p in parts.iter_mut() {
        let pp = Path::new(&p.path);
        if let Some((_, why)) = t.deny.iter().find(|(n, _)| *n == p.name) {
            p.block = Some(Block::new(BlockSource::Rule, *why));
        } else if let Some(prot) = safety::within_any(pp, &ctx.protected_paths) {
            p.block = Some(Block::new(BlockSource::User, format!("Inside your protected path {}.", prot.display())));
        } else if let Some(prot) = safety::contains_any(pp, &ctx.protected_paths) {
            p.block = Some(Block::new(BlockSource::User, format!("Contains your protected path {}.", prot.display())));
        } else if let Some(kind) = safety::redirection(pp) {
            p.block = Some(Block::new(BlockSource::System, format!("This is a {kind}; it is never deleted through.")));
        }
        if let Some(def) = &default_tc {
            if def.starts_with(p.name.as_str()) || p.name.starts_with(def.as_str()) {
                p.warning = Some(Warning::danger(format!("{} is your default toolchain. Removing it breaks cargo and rustc until you reinstall it.", p.name)));
                p.usage = Some(Usage::Used { by: vec!["your default toolchain".into()] });
            }
        }
        if t.id == "claude-versions" {
            let active = match &claude {
                Some(a) => safety::same_path(a, &safety::normalize(pp)),
                None => newest_part.as_deref() == Some(p.path.as_str()),
            };
            if active {
                let why = if claude.is_some() { "This is the version the claude command uses." } else { "Probably the version in use (the newest one)." };
                p.block = Some(Block::new(BlockSource::Rule, why));
            }
        }
        p.in_use = check_use(pp);
        if let Some(u) = p.in_use.as_ref().filter(|u| u.in_use()) {
            p.warning = Some(Warning::danger(format!("{}. Close it before removing this.", u.describe())));
        }
        if t.id == "temp-win" && idle(p.last_modified, now).is_some_and(|d| d < TEMP_STALE_DAYS) {
            p.block.get_or_insert(Block::new(BlockSource::Rule, format!("Changed in the last {TEMP_STALE_DAYS} days; a running program may still use it.")));
        }
        if p.usage.is_none() {
            if let Some(u) = refs.and_then(|r| r.usage_of(t.id, &p.name)) {
                references_checked = true;
                p.usage = Some(u);
            }
        }
        let mut prisk = risk;
        if risk == Risk::Danger && matches!(p.usage, Some(Usage::Unused { .. })) {
            prisk = Risk::Caution;
        }
        if p.block.is_some() {
            prisk = Risk::Blocked;
        }
        p.risk = (prisk != risk).then_some(prisk);
        let pw: Vec<Warning> = warnings.iter().cloned().chain(p.warning.clone()).collect();
        p.recommendation = Some(recommend::recommend(&Facts {
            risk: prisk,
            category: t.cat,
            confidence: Confidence::High,
            min_confidence: min_conf,
            block: p.block.as_ref().or(block.as_ref()),
            git: GitStatus::NotRepository,
            reclaimable: p.reclaimable_bytes,
            idle_days: idle(p.last_modified, now),
            project_idle_days: None,
            rebuild_cost: t.rebuild,
            network_cost: t.net,
            download_bytes: download(t.cat, t.net, p.disk_bytes),
            warnings: &pw,
            usage: p.usage.as_ref(),
        }));
    }

    let dl = download(t.cat, t.net, st.disk_bytes);
    let mut recommendation = recommend::recommend(&Facts {
        risk,
        category: t.cat,
        confidence: Confidence::High,
        min_confidence: min_conf,
        block: block.as_ref(),
        git: GitStatus::NotRepository,
        reclaimable: st.reclaimable_bytes,
        idle_days: idle(st.newest, now),
        project_idle_days: None,
        rebuild_cost: t.rebuild,
        network_cost: t.net,
        download_bytes: dl,
        warnings: &warnings,
        usage: None,
    });
    if block.is_none() {
        if t.parts_only {
            let n = parts.iter().filter(|p| p.recommendation.as_ref().is_some_and(|r| r.verdict == Verdict::Recommended)).count();
            recommendation.verdict = if n > 0 { Verdict::Review } else { recommendation.verdict.max_keep() };
            recommendation.reasons.push(crate::model::Reason::no(if n > 0 { format!("Only individual parts can be removed; {n} are recommended") } else { "Only individual parts can be removed".into() }));
        } else if parts.iter().any(|p| p.block.is_some() || matches!(p.usage, Some(Usage::Used { .. })) || p.in_use.as_ref().is_some_and(|u| u.in_use())) {
            recommendation.verdict = Verdict::Keep;
            recommendation.score = recommendation.score.min(30);
            recommendation.reasons.push(crate::model::Reason::no("Some parts are in use; choose parts instead of the whole folder"));
        }
    }

    GlobalCache {
        id: t.id.into(),
        scan_id: ctx.scan_id.clone(),
        name: t.name.into(),
        ecosystem: t.eco.into(),
        category: t.cat,
        group: t.cat.group().into(),
        fingerprint: safety::fingerprint(&path).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        exists,
        disk_bytes: st.disk_bytes,
        apparent_bytes: st.apparent_bytes,
        reclaimable_bytes: st.reclaimable_bytes,
        file_count: st.files,
        last_modified: st.newest,
        note: t.note.into(),
        consequence: t.consequence.into(),
        regenerates_with: t.recovery.into(),
        parts,
        parts_only: t.parts_only,
        info_only: t.info_only,
        warnings,
        risk,
        rebuild_cost: t.rebuild,
        network_cost: t.net,
        download_bytes: dl,
        block,
        recommendation,
        references_checked,
        in_use,
    }
}

impl Verdict {
    /// Never upgrade a verdict to Recommended.
    fn max_keep(self) -> Verdict {
        match self {
            Verdict::Recommended => Verdict::Review,
            v => v,
        }
    }
}

/// Extra files removed together with a part, e.g. the `.ini` that registers an emulator.
pub fn companions(cache_id: &str, part: &Path) -> Vec<PathBuf> {
    if cache_id == "android-avd" {
        if let (Some(stem), Some(parent)) = (part.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".avd")), part.parent()) {
            let ini = parent.join(format!("{stem}.ini"));
            if ini.is_file() {
                return vec![ini];
            }
        }
    }
    vec![]
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
pub fn scan_global_caches<F, P>(env: &Env, ctx: &GlobalContext, cancel: &std::sync::atomic::AtomicBool, on_item: F, on_progress: P) -> Vec<GlobalCache>
where
    F: Fn(&GlobalCache) + Sync,
    P: Fn(GlobalProgress) + Sync,
{
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    let defs: Vec<(&Def, PathBuf)> = defs_for(env).collect();
    let snap = if ctx.detect_active_usage { Snapshot::take() } else { None };
    let total = defs.len() as u64 + u64::from(env.os == "windows");
    let done = AtomicU64::new(0);
    let mut out: Vec<GlobalCache> = defs
        .into_par_iter()
        .filter_map(|(t, path)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let c = measure(t, path, env, ctx, snap.as_ref());
            if c.exists {
                on_item(&c);
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(GlobalProgress { done: n, total, current: c.name.clone() });
            c.exists.then_some(c)
        })
        .collect();
    if !cancel.load(Ordering::Relaxed) {
        if let Some(w) = wsl_distros(env, &ctx.scan_id) {
            on_progress(GlobalProgress { done: total, total, current: w.name.clone() });
            if w.exists {
                on_item(&w);
                out.push(w);
            }
        }
    }
    out.sort_by(|a, b| b.disk_bytes.cmp(&a.disk_bytes));
    out
}

pub fn list_global_caches_with(env: &Env) -> Vec<GlobalCache> {
    scan_global_caches(env, &GlobalContext { detect_sensitive_files: true, ..Default::default() }, &std::sync::atomic::AtomicBool::new(false), |_| {}, |_| {})
}
