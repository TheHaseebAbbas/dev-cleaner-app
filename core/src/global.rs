//! Global (per-user) caches such as npm, Gradle, Xcode DerivedData.

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
}

struct Def {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    /// "all", "linux", "macos" or "windows".
    os: &'static str,
    /// Path relative to the home directory.
    path: &'static str,
    note: &'static str,
    /// Offer each direct child folder as an independent optional part.
    split: bool,
}

const fn d(id: &'static str, name: &'static str, category: &'static str, os: &'static str, path: &'static str, note: &'static str, split: bool) -> Def {
    Def { id, name, category, os, path, note, split }
}

const TABLE: &[Def] = &[
    d("npm", "npm cache", "Node.js", "all", ".npm/_cacache", "Re-downloaded on demand", false),
    d("yarn", "Yarn cache", "Node.js", "linux", ".cache/yarn", "Re-downloaded on demand", false),
    d("yarn-mac", "Yarn cache", "Node.js", "macos", "Library/Caches/Yarn", "Re-downloaded on demand", false),
    d("pnpm", "pnpm store", "Node.js", "linux", ".local/share/pnpm/store", "Re-linked on next install", false),
    d("pnpm-mac", "pnpm store", "Node.js", "macos", "Library/pnpm/store", "Re-linked on next install", false),
    d("cargo-registry", "Cargo registry", "Rust", "all", ".cargo/registry", "index, downloaded crates (cache) and unpacked sources (src); all re-downloaded on demand", true),
    d("gradle-caches", "Gradle caches", "Android/Gradle", "all", ".gradle/caches", "Re-downloaded; next build is slow. Parts are independent", true),
    d("gradle-wrapper", "Gradle distributions", "Android/Gradle", "all", ".gradle/wrapper/dists", "One folder per Gradle version; the right one is re-downloaded when a project needs it", true),
    d("maven", "Maven repository", "Java", "all", ".m2/repository", "Re-downloaded; next build is slow", false),
    d("pub-cache", "Dart pub cache", "Flutter/Dart", "all", ".pub-cache", "flutter pub get restores it. hosted = pub.dev packages, git = git dependencies", true),
    d("fvm-versions", "FVM Flutter SDKs", "Flutter/Dart", "all", "fvm/versions", "One folder per installed Flutter SDK; fvm install brings one back", true),
    d("pip-linux", "pip cache", "Python", "linux", ".cache/pip", "Re-downloaded on demand", false),
    d("pip-mac", "pip cache", "Python", "macos", "Library/Caches/pip", "Re-downloaded on demand", false),
    d("go-build", "Go build cache", "Go", "linux", ".cache/go-build", "Rebuilt on next build", false),
    d("nuget", "NuGet packages", ".NET", "all", ".nuget/packages", "dotnet restore re-downloads; one folder per package", true),
    d("deriveddata", "Xcode DerivedData", "iOS/macOS", "macos", "Library/Developer/Xcode/DerivedData", "One folder per project, rebuilt by Xcode", true),
    d("xcode-archives", "Xcode Archives", "iOS/macOS", "macos", "Library/Developer/Xcode/Archives", "Archives cannot be recreated; review each date first", true),
    d("ios-devicesupport", "iOS DeviceSupport", "iOS/macOS", "macos", "Library/Developer/Xcode/iOS DeviceSupport", "One folder per iOS version; recreated when a device is connected", true),
    d("simulators", "CoreSimulator devices", "iOS/macOS", "macos", "Library/Developer/CoreSimulator/Devices", "One folder per simulator; its data is lost", true),
    d("cocoapods", "CocoaPods cache", "iOS/macOS", "macos", "Library/Caches/CocoaPods", "Re-downloaded on demand", false),
    d("homebrew", "Homebrew cache", "System", "macos", "Library/Caches/Homebrew", "Re-downloaded on demand", false),
    d("android-avd", "Android emulators (AVD)", "Android/Gradle", "all", ".android/avd", "One folder per virtual device; its data is lost", true),
    d("claude-versions", "Claude Code old versions", "AI tools", "all", ".local/share/claude/versions", "One file per version; keep the one in use", false),
];

pub fn list_global_caches() -> Vec<GlobalCache> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    let os = std::env::consts::OS;
    TABLE
        .iter()
        .filter(|t| t.os == "all" || t.os == os)
        .map(|t| {
            let path: PathBuf = home.join(t.path);
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
            }
        })
        .collect()
}
