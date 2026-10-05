//! Global (per-user) caches such as npm, Gradle, Xcode DerivedData.

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
}

/// (id, name, category, os filter, path relative to home, note)
const TABLE: &[(&str, &str, &str, &str, &str, &str)] = &[
    ("npm", "npm cache", "Node.js", "all", ".npm/_cacache", "Re-downloaded on demand"),
    ("yarn", "Yarn cache", "Node.js", "linux", ".cache/yarn", "Re-downloaded on demand"),
    ("yarn-mac", "Yarn cache", "Node.js", "macos", "Library/Caches/Yarn", "Re-downloaded on demand"),
    ("pnpm", "pnpm store", "Node.js", "linux", ".local/share/pnpm/store", "Re-linked on next install"),
    ("pnpm-mac", "pnpm store", "Node.js", "macos", "Library/pnpm/store", "Re-linked on next install"),
    ("cargo-registry", "Cargo registry", "Rust", "all", ".cargo/registry", "Re-downloaded on demand"),
    ("gradle-caches", "Gradle caches", "Android/Gradle", "all", ".gradle/caches", "Re-downloaded; next build is slow"),
    ("maven", "Maven repository", "Java", "all", ".m2/repository", "Re-downloaded; next build is slow"),
    ("pub-cache", "Dart pub cache", "Flutter/Dart", "all", ".pub-cache", "flutter pub get restores it"),
    ("pip-linux", "pip cache", "Python", "linux", ".cache/pip", "Re-downloaded on demand"),
    ("pip-mac", "pip cache", "Python", "macos", "Library/Caches/pip", "Re-downloaded on demand"),
    ("go-build", "Go build cache", "Go", "linux", ".cache/go-build", "Rebuilt on next build"),
    ("nuget", "NuGet packages", ".NET", "all", ".nuget/packages", "dotnet restore re-downloads"),
    ("deriveddata", "Xcode DerivedData", "iOS/macOS", "macos", "Library/Developer/Xcode/DerivedData", "Rebuilt by Xcode"),
    ("xcode-archives", "Xcode Archives", "iOS/macOS", "macos", "Library/Developer/Xcode/Archives", "Archives cannot be recreated; review first"),
    ("ios-devicesupport", "iOS DeviceSupport", "iOS/macOS", "macos", "Library/Developer/Xcode/iOS DeviceSupport", "Recreated when a device is connected"),
    ("simulators", "CoreSimulator devices", "iOS/macOS", "macos", "Library/Developer/CoreSimulator/Devices", "Simulator data is lost"),
    ("cocoapods", "CocoaPods cache", "iOS/macOS", "macos", "Library/Caches/CocoaPods", "Re-downloaded on demand"),
    ("homebrew", "Homebrew cache", "System", "macos", "Library/Caches/Homebrew", "Re-downloaded on demand"),
    ("android-avd", "Android emulators (AVD)", "Android/Gradle", "all", ".android/avd", "Emulator images are lost"),
    ("claude-versions", "Claude Code old versions", "AI tools", "all", ".local/share/claude/versions", "Keep the version in use"),
];

pub fn list_global_caches() -> Vec<GlobalCache> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    let os = std::env::consts::OS;
    TABLE
        .iter()
        .filter(|t| t.3 == "all" || t.3 == os)
        .map(|t| {
            let path: PathBuf = home.join(t.4);
            let exists = path.is_dir();
            let st = if exists { crate::scanner::dir_stats(&path) } else { Default::default() };
            GlobalCache {
                id: t.0.into(),
                name: t.1.into(),
                category: t.2.into(),
                path: path.to_string_lossy().into_owned(),
                exists,
                disk_bytes: st.disk_bytes,
                file_count: st.files,
                note: t.5.into(),
            }
        })
        .collect()
}
