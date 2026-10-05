//! Cleanup rules: which directories are rebuildable artifacts, and how to recognise them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// Regenerated automatically by the normal build/install step.
    Low,
    /// Regenerated, but slow or needs network (e.g. full dependency download).
    Medium,
    /// May hold state that is hard to recreate; always ask.
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub ecosystem: String,
    /// Directory names this rule matches (the last path component).
    pub dir_names: Vec<String>,
    /// At least one of these must exist in the parent directory (`*.ext` globs allowed).
    /// Empty means no parent requirement.
    #[serde(default)]
    pub parent_markers: Vec<String>,
    /// At least one of these must exist inside the candidate itself. Empty means none required.
    #[serde(default)]
    pub self_markers: Vec<String>,
    /// How the directory comes back, shown in the details panel.
    pub regenerates_with: String,
    pub risk: Risk,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub custom: bool,
}

fn yes() -> bool {
    true
}

fn rule(
    id: &str,
    name: &str,
    eco: &str,
    dirs: &[&str],
    parent: &[&str],
    selfm: &[&str],
    regen: &str,
    risk: Risk,
) -> Rule {
    let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect();
    Rule {
        id: id.into(),
        name: name.into(),
        ecosystem: eco.into(),
        dir_names: v(dirs),
        parent_markers: v(parent),
        self_markers: v(selfm),
        regenerates_with: regen.into(),
        risk,
        enabled: true,
        custom: false,
    }
}

const GRADLE: &[&str] = &["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
const DOTNET: &[&str] = &["*.csproj", "*.fsproj", "*.vbproj"];

pub fn builtin_rules() -> Vec<Rule> {
    use Risk::*;
    vec![
        rule("node_modules", "node_modules", "Node.js", &["node_modules"], &["package.json"], &[], "npm/yarn/pnpm install", Medium),
        rule("next", ".next build", "Node.js", &[".next"], &["package.json"], &[], "next build / next dev", Low),
        rule("nuxt", ".nuxt / .output", "Node.js", &[".nuxt", ".output"], &["package.json"], &[], "nuxt build / dev", Low),
        rule("js-caches", "JS tool caches", "Node.js", &[".turbo", ".parcel-cache", ".svelte-kit", ".vite", ".angular"], &["package.json"], &[], "regenerated on next build", Low),
        rule("flutter-build", "Flutter build", "Flutter/Dart", &["build"], &["pubspec.yaml"], &[], "flutter build / run", Low),
        rule("dart-tool", ".dart_tool", "Flutter/Dart", &[".dart_tool"], &["pubspec.yaml"], &[], "flutter pub get", Low),
        rule("fvm", ".fvm", "Flutter/Dart", &[".fvm"], &["pubspec.yaml"], &[], "fvm install", Medium),
        rule("pods", "CocoaPods Pods", "iOS/macOS", &["Pods"], &["Podfile"], &[], "pod install", Medium),
        rule("gradle-project", ".gradle (project)", "Android/Gradle", &[".gradle"], GRADLE, &[], "gradle build", Low),
        rule("gradle-build", "Gradle build output", "Android/Gradle", &["build"], GRADLE, &[], "gradle build", Low),
        rule("rust-target", "Rust target", "Rust", &["target"], &["Cargo.toml"], &[], "cargo build", Medium),
        rule("maven-target", "Maven target", "Java", &["target"], &["pom.xml"], &[], "mvn package", Low),
        rule("python-venv", "Python virtualenv", "Python", &[".venv", "venv", "env"], &[], &["pyvenv.cfg"], "python -m venv + pip install", Medium),
        rule("python-cache", "Python caches", "Python", &["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox"], &[], &[], "regenerated on next run", Low),
        rule("dotnet-bin-obj", "bin / obj", ".NET", &["bin", "obj"], DOTNET, &[], "dotnet build", Low),
        rule("visual-studio", ".vs", ".NET", &[".vs"], &["*.sln"], &[], "reopen in Visual Studio", Low),
        rule("swift-build", "SwiftPM .build", "Swift", &[".build"], &["Package.swift"], &[], "swift build", Low),
        rule("elixir-build", "Elixir _build / deps", "Elixir", &["_build", "deps"], &["mix.exs"], &[], "mix deps.get / compile", Medium),
        rule("zig-cache", "Zig cache", "Zig", &["zig-cache", ".zig-cache", "zig-out"], &["build.zig"], &[], "zig build", Low),
        rule("haskell", "Haskell build", "Haskell", &[".stack-work", "dist-newstyle"], &["stack.yaml", "*.cabal", "cabal.project"], &[], "stack/cabal build", Medium),
        rule("terraform", ".terraform", "Terraform", &[".terraform"], &["*.tf"], &[], "terraform init", Low),
        rule("unity-library", "Unity Library", "Unity", &["Library", "Temp", "Obj"], &["ProjectSettings"], &[], "reopen project (slow reimport)", Medium),
        rule("go-vendor", "Go vendor", "Go", &["vendor"], &["go.mod"], &[], "go mod vendor", Medium),
        rule("php-vendor", "Composer vendor", "PHP", &["vendor"], &["composer.json"], &[], "composer install", Medium),
        rule("ruby-bundle", "Bundler vendor/bundle", "Ruby", &[".bundle"], &["Gemfile"], &[], "bundle install", Medium),
    ]
}

/// Match `*.ext` style or exact names against a directory listing.
pub fn marker_present(dir: &std::path::Path, marker: &str) -> bool {
    if let Some(ext) = marker.strip_prefix('*') {
        match std::fs::read_dir(dir) {
            Ok(rd) => rd
                .flatten()
                .any(|e| e.file_name().to_string_lossy().ends_with(ext)),
            Err(_) => false,
        }
    } else {
        dir.join(marker).exists()
    }
}

impl Rule {
    pub fn matches(&self, path: &std::path::Path) -> bool {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            return false;
        };
        if !self.dir_names.iter().any(|d| *d == name) {
            return false;
        }
        if !self.parent_markers.is_empty() {
            let Some(parent) = path.parent() else { return false };
            if !self.parent_markers.iter().any(|m| marker_present(parent, m)) {
                return false;
            }
        }
        if !self.self_markers.is_empty()
            && !self.self_markers.iter().any(|m| marker_present(path, m))
        {
            return false;
        }
        true
    }
}
