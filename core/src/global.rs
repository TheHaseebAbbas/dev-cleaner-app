//! Global (per-user) caches and SDK components: npm, Gradle, Android SDK, JetBrains, Xcode, ...
//!
//! Locations are resolved per OS (home folder, `%LOCALAPPDATA%`, the Android SDK root).

use crate::scanner::{dir_stats, dir_stats_parts, Part};
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
}

const fn d(id: &'static str, name: &'static str, category: &'static str, os: &'static str, base: Base, path: &'static str, note: &'static str, split: bool) -> Def {
    Def { id, name, category, os, base, path, note, split, parts_only: false }
}

const fn parts_only(mut def: Def) -> Def {
    def.split = true;
    def.parts_only = true;
    def
}

use Base::{AndroidSdk, Home, LocalData};

const SDK_NOTE: &str = "Part of the Android SDK. Re-download any version in Android Studio's SDK Manager (needs internet); only remove versions you no longer build against";

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
    d("rustup-toolchains", "Rust toolchains", "Rust", "all", Home, ".rustup/toolchains", "One folder per installed toolchain; keep the one you use (rustup show). rustup install brings one back", true),
    // Java / Gradle / Maven
    d("gradle-caches", "Gradle caches", "Android/Gradle", "all", Home, ".gradle/caches", "Re-downloaded; next build is slow. Parts are independent", true),
    d("gradle-wrapper", "Gradle distributions", "Android/Gradle", "all", Home, ".gradle/wrapper/dists", "One folder per Gradle version; the right one is re-downloaded when a project needs it", true),
    d("maven", "Maven repository", "Java", "all", Home, ".m2/repository", "Re-downloaded; next build is slow", false),
    // Android SDK (location from ANDROID_HOME / ANDROID_SDK_ROOT, else the OS default; AppData on Windows)
    d("android-platforms", "Android SDK platforms", "Android SDK", "all", AndroidSdk, "platforms", SDK_NOTE, true),
    d("android-build-tools", "Android SDK build-tools", "Android SDK", "all", AndroidSdk, "build-tools", SDK_NOTE, true),
    d("android-ndk", "Android NDK", "Android SDK", "all", AndroidSdk, "ndk", SDK_NOTE, true),
    d("android-cmake", "Android CMake", "Android SDK", "all", AndroidSdk, "cmake", SDK_NOTE, true),
    d("android-system-images", "Android emulator system images", "Android SDK", "all", AndroidSdk, "system-images", SDK_NOTE, true),
    d("android-sources", "Android SDK sources", "Android SDK", "all", AndroidSdk, "sources", SDK_NOTE, true),
    d("android-avd", "Android emulators (AVD)", "Android SDK", "all", Home, ".android/avd", "One folder per virtual device; its data is lost", true),
    // Dart / Flutter
    d("pub-cache", "Dart pub cache", "Flutter/Dart", "unix", Home, ".pub-cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true),
    d("pub-cache-win", "Dart pub cache", "Flutter/Dart", "windows", LocalData, "Pub/Cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true),
    d("fvm-versions", "FVM Flutter SDKs", "Flutter/Dart", "unix", Home, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true),
    d("fvm-versions-win", "FVM Flutter SDKs", "Flutter/Dart", "windows", LocalData, "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true),
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
    d("xcode-archives", "Xcode Archives", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/Archives", "Archives cannot be recreated; review each date first", true),
    d("ios-devicesupport", "iOS DeviceSupport", "iOS/macOS", "macos", Home, "Library/Developer/Xcode/iOS DeviceSupport", "One folder per iOS version; recreated when a device is connected", true),
    d("simulators", "CoreSimulator devices", "iOS/macOS", "macos", Home, "Library/Developer/CoreSimulator/Devices", "One folder per simulator; its data is lost", true),
    d("cocoapods", "CocoaPods cache", "iOS/macOS", "macos", Home, "Library/Caches/CocoaPods", "Re-downloaded on demand", false),
    d("homebrew", "Homebrew cache", "System", "macos", Home, "Library/Caches/Homebrew", "Re-downloaded on demand", false),
    // Windows temp and AI tools
    parts_only(d("temp-win", "Windows user Temp", "System", "windows", LocalData, "Temp", "Leftover temporary files. Items in use by a running program cannot be removed and are reported as errors", true)),
    d("claude-versions", "Claude Code old versions", "AI tools", "all", Home, ".local/share/claude/versions", "One file per version; keep the one in use", false),
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
    defs_for(env)
        .map(|(t, p)| Location { id: t.id.into(), name: t.name.into(), category: t.category.into(), exists: p.is_dir(), path: p.to_string_lossy().into_owned() })
        .collect()
}

pub fn locations() -> Vec<Location> {
    locations_with(&Env::detect())
}

pub fn list_global_caches() -> Vec<GlobalCache> {
    list_global_caches_with(&Env::detect())
}

pub fn list_global_caches_with(env: &Env) -> Vec<GlobalCache> {
    defs_for(env)
        .map(|(t, path)| {
            let exists = path.is_dir();
            let (st, parts) = match (exists, t.split) {
                (false, _) => Default::default(),
                (true, true) => dir_stats_parts(&path),
                (true, false) => (dir_stats(&path), vec![]),
            };
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
            }
        })
        .collect()
}
