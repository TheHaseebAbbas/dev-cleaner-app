//! Detection rules: which project folders are cleanup candidates, what they are, and what it costs
//! to lose them.
//!
//! A rule only *detects*. Whether a match may be removed is decided later by the safety checks
//! (protected paths, Git, sensitive files) and the recommendation engine.

pub use crate::model::Risk;
use crate::model::{Category, Confidence, Cost};
use serde::{Deserialize, Serialize};

/// Bumped when built-in rule semantics change, so History can say which logic removed something.
pub const RULES_VERSION: u32 = 2;

fn yes() -> bool {
    true
}
fn one() -> u32 {
    1
}
fn unknown_cat() -> Category {
    Category::Unknown
}
fn unknown_cost() -> Cost {
    Cost::Unknown
}
fn medium() -> Confidence {
    Confidence::Medium
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    #[serde(default = "one")]
    pub version: u32,
    pub name: String,
    pub ecosystem: String,
    #[serde(default = "unknown_cat")]
    pub category: Category,
    /// Directory names this rule matches (the last path component).
    pub dir_names: Vec<String>,
    /// At least one of these must exist in the parent directory (`*.ext` globs and `../name`
    /// allowed). Empty means no parent requirement.
    #[serde(default)]
    pub parent_markers: Vec<String>,
    /// At least one of these must exist inside the candidate itself. Empty means none required.
    #[serde(default)]
    pub self_markers: Vec<String>,
    /// Optional files beside the folder that make the match more certain (lock files, configs).
    #[serde(default)]
    pub confidence_markers: Vec<String>,
    /// How sure a plain match is, before supporting evidence and Git are considered.
    #[serde(default = "medium")]
    pub base_confidence: Confidence,
    /// Command or action that brings the folder back.
    pub regenerates_with: String,
    /// Plain-language explanation of what the folder contains.
    #[serde(default)]
    pub description: String,
    /// What happens if it is removed.
    #[serde(default)]
    pub consequence: String,
    /// When true, each direct child folder is offered as an independent, optional part.
    #[serde(default)]
    pub split: bool,
    pub risk: Risk,
    #[serde(default = "unknown_cost")]
    pub rebuild_cost: Cost,
    #[serde(default = "unknown_cost")]
    pub network_cost: Cost,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub custom: bool,
    /// Custom rules only: set after the first real cleanup that used this rule was confirmed.
    #[serde(default)]
    pub confirmed: bool,
}

struct R {
    id: &'static str,
    name: &'static str,
    eco: &'static str,
    cat: Category,
    dirs: &'static [&'static str],
    parent: &'static [&'static str],
    selfm: &'static [&'static str],
    conf: &'static [&'static str],
    regen: &'static str,
    risk: Risk,
    rebuild: Cost,
    net: Cost,
    desc: &'static str,
    consequence: &'static str,
    split: bool,
}

const GRADLE: &[&str] = &["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
const DOTNET: &[&str] = &["*.csproj", "*.fsproj", "*.vbproj"];
const PKG: &[&str] = &["package.json"];
const PUB: &[&str] = &["pubspec.yaml"];
const NONE: &[&str] = &[];

use Category::*;
use Cost::{High, Low, Medium, None as Free};
use Risk::{Caution, Safe};

#[rustfmt::skip]
const BUILTIN: &[R] = &[
    R { id: "node_modules", name: "node_modules", eco: "Node.js", cat: ProjectDependency, dirs: &["node_modules"], parent: PKG, selfm: NONE, conf: &["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"], regen: "npm install", risk: Caution, rebuild: Medium, net: Medium,
        desc: "Installed npm/yarn/pnpm packages for this project. Your source code and package.json are not touched.",
        consequence: "Dependencies must be installed again before the project runs or builds.", split: false },
    R { id: "next", name: ".next build", eco: "Node.js", cat: BuildArtifact, dirs: &[".next"], parent: PKG, selfm: NONE, conf: &["next.config.js", "next.config.mjs", "next.config.ts"], regen: "next build / next dev", risk: Safe, rebuild: Low, net: Free,
        desc: "Next.js build output. `cache` holds incremental build data; `server` and `static` are the compiled site.",
        consequence: "The next `next dev` or `next build` recreates it; the first build is slower.", split: true },
    R { id: "nuxt", name: ".nuxt", eco: "Node.js", cat: BuildArtifact, dirs: &[".nuxt"], parent: PKG, selfm: NONE, conf: &["nuxt.config.ts", "nuxt.config.js"], regen: "nuxt dev / nuxt build", risk: Safe, rebuild: Low, net: Free,
        desc: "Nuxt generated files used during development.",
        consequence: "Nuxt regenerates it on the next dev or build run.", split: false },
    R { id: "nuxt-output", name: ".output (Nuxt)", eco: "Node.js", cat: BuildArtifact, dirs: &[".output"], parent: PKG, selfm: NONE, conf: &["nuxt.config.ts", "nuxt.config.js"], regen: "nuxt build", risk: Safe, rebuild: Low, net: Free,
        desc: "Generated Nuxt server output, ready to deploy.",
        consequence: "You need another `nuxt build` before you can deploy again.", split: false },
    R { id: "js-caches", name: "JS tool caches", eco: "Node.js", cat: ToolCache, dirs: &[".turbo", ".parcel-cache", ".svelte-kit", ".vite", ".angular"], parent: PKG, selfm: NONE, conf: &["angular.json", "turbo.json", "svelte.config.js", "vite.config.ts", "vite.config.js"], regen: "regenerated on next build", risk: Safe, rebuild: Low, net: Free,
        desc: "Build-tool caches (Turborepo, Parcel, Vite, SvelteKit, Angular). Rebuilt automatically.",
        consequence: "The next build is slower while the cache fills again.", split: false },
    R { id: "flutter-build", name: "Flutter build", eco: "Flutter/Dart", cat: BuildArtifact, dirs: &["build"], parent: PUB, selfm: NONE, conf: &["pubspec.lock"], regen: "flutter build / run", risk: Safe, rebuild: Low, net: Free,
        desc: "Flutter build output. Each platform (android, ios, web, ...) is built separately and can be removed on its own.",
        consequence: "The Flutter project rebuilds this folder automatically on the next run or build.", split: true },
    R { id: "dart-tool", name: ".dart_tool", eco: "Flutter/Dart", cat: ToolCache, dirs: &[".dart_tool"], parent: PUB, selfm: NONE, conf: &["pubspec.lock"], regen: "flutter pub get", risk: Safe, rebuild: Low, net: Low,
        desc: "Dart tooling metadata and package config for this project.",
        consequence: "Run `flutter pub get` (or any flutter command) and it comes back.", split: false },
    R { id: "fvm", name: ".fvm", eco: "Flutter/Dart", cat: ToolingState, dirs: &[".fvm"], parent: PUB, selfm: NONE, conf: &[".fvmrc"], regen: "fvm use / fvm install", risk: Caution, rebuild: Low, net: Medium,
        desc: "FVM project configuration and the link to the Flutter SDK this project is pinned to.",
        consequence: "Removing it may affect the project's FVM configuration until you run `fvm use` again.", split: false },
    R { id: "pods", name: "CocoaPods Pods", eco: "iOS/macOS", cat: ProjectDependency, dirs: &["Pods"], parent: &["Podfile"], selfm: NONE, conf: &["Podfile.lock"], regen: "pod install", risk: Caution, rebuild: Medium, net: Medium,
        desc: "CocoaPods dependencies for the iOS/macOS part of this project.",
        consequence: "`pod install` must download and integrate the pods again before the next build.", split: false },
    R { id: "gradle-project", name: ".gradle (project)", eco: "Android/Gradle", cat: ToolCache, dirs: &[".gradle"], parent: GRADLE, selfm: NONE, conf: &["gradlew", "gradle.properties"], regen: "gradle build", risk: Safe, rebuild: Low, net: Free,
        desc: "Gradle's per-project cache and task state.",
        consequence: "The next Gradle build recreates it; it may run a bit longer.", split: false },
    R { id: "gradle-build", name: "Gradle build output", eco: "Android/Gradle", cat: BuildArtifact, dirs: &["build"], parent: GRADLE, selfm: NONE, conf: &["gradlew", "gradle.properties"], regen: "gradle build", risk: Safe, rebuild: Low, net: Free,
        desc: "Android/Java compiled output. Independent from your source code.",
        consequence: "The next Gradle build compiles it again.", split: false },
    R { id: "rust-target", name: "Rust target", eco: "Rust", cat: BuildArtifact, dirs: &["target"], parent: &["Cargo.toml"], selfm: NONE, conf: &["Cargo.lock"], regen: "cargo build", risk: Safe, rebuild: Medium, net: Free,
        desc: "Cargo build output. `debug` and `release` (and cross-compile targets) are separate and can be removed on their own.",
        consequence: "The next `cargo build` compiles everything again, which can take minutes for large projects.", split: true },
    R { id: "maven-target", name: "Maven target", eco: "Java", cat: BuildArtifact, dirs: &["target"], parent: &["pom.xml"], selfm: NONE, conf: &["mvnw"], regen: "mvn package", risk: Safe, rebuild: Low, net: Free,
        desc: "Maven compiled classes and packaged artifacts.",
        consequence: "The next `mvn package` builds it again.", split: false },
    R { id: "python-venv", name: "Python virtualenv", eco: "Python", cat: VirtualEnvironment, dirs: &[".venv", "venv", "env"], parent: NONE, selfm: &["pyvenv.cfg"], conf: &["requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock", "uv.lock", "environment.yml", "setup.py", "setup.cfg"], regen: "python -m venv + pip install", risk: Caution, rebuild: Medium, net: Medium,
        desc: "A Python virtual environment with its installed packages.",
        consequence: "The environment and every package installed in it are gone; recreate it and reinstall the packages.", split: false },
    R { id: "python-cache", name: "Python caches", eco: "Python", cat: ToolCache, dirs: &["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox"], parent: NONE, selfm: NONE, conf: NONE, regen: "regenerated on next run", risk: Safe, rebuild: Free, net: Free,
        desc: "Bytecode and test/lint tool caches. Rebuilt on the next run.",
        consequence: "Python and the tools rebuild these caches automatically.", split: false },
    R { id: "dotnet-bin-obj", name: "bin / obj", eco: ".NET", cat: BuildArtifact, dirs: &["bin", "obj"], parent: DOTNET, selfm: NONE, conf: &["*.sln", "global.json"], regen: "dotnet build", risk: Safe, rebuild: Low, net: Free,
        desc: ".NET compiled binaries and intermediate files.",
        consequence: "The next `dotnet build` compiles it again.", split: false },
    R { id: "visual-studio", name: ".vs", eco: ".NET", cat: IdeCache, dirs: &[".vs"], parent: &["*.sln"], selfm: NONE, conf: NONE, regen: "reopen in Visual Studio", risk: Safe, rebuild: Free, net: Free,
        desc: "Visual Studio per-solution settings and caches.",
        consequence: "Visual Studio forgets open tabs and per-solution layout, and rebuilds its caches.", split: false },
    R { id: "swift-build", name: "SwiftPM .build", eco: "Swift", cat: BuildArtifact, dirs: &[".build"], parent: &["Package.swift"], selfm: NONE, conf: &["Package.resolved"], regen: "swift build", risk: Safe, rebuild: Low, net: Low,
        desc: "Swift Package Manager build output and checked-out dependencies.",
        consequence: "The next `swift build` resolves and compiles everything again.", split: false },
    R { id: "elixir-build", name: "Elixir _build", eco: "Elixir", cat: BuildArtifact, dirs: &["_build"], parent: &["mix.exs"], selfm: NONE, conf: &["mix.lock"], regen: "mix compile", risk: Safe, rebuild: Low, net: Free,
        desc: "Elixir compiled code, one folder per environment (dev, test, prod).",
        consequence: "The next `mix compile` builds it again.", split: true },
    R { id: "elixir-deps", name: "Elixir deps", eco: "Elixir", cat: ProjectDependency, dirs: &["deps"], parent: &["mix.exs"], selfm: NONE, conf: &["mix.lock"], regen: "mix deps.get", risk: Caution, rebuild: Medium, net: Medium,
        desc: "Dependencies fetched by Mix for this project.",
        consequence: "`mix deps.get` must download the dependencies again.", split: false },
    R { id: "zig-cache", name: "Zig cache", eco: "Zig", cat: BuildArtifact, dirs: &["zig-cache", ".zig-cache", "zig-out"], parent: &["build.zig"], selfm: NONE, conf: &["build.zig.zon"], regen: "zig build", risk: Safe, rebuild: Low, net: Free,
        desc: "Zig compiler cache and build output.",
        consequence: "The next `zig build` recreates it.", split: false },
    R { id: "haskell", name: "Haskell build", eco: "Haskell", cat: BuildArtifact, dirs: &[".stack-work", "dist-newstyle"], parent: &["stack.yaml", "*.cabal", "cabal.project"], selfm: NONE, conf: &["stack.yaml.lock", "cabal.project.freeze"], regen: "stack/cabal build", risk: Caution, rebuild: High, net: Low,
        desc: "Haskell (Stack/Cabal) build output.",
        consequence: "The next build compiles the project and its dependencies again, which can be slow.", split: false },
    R { id: "terraform", name: ".terraform", eco: "Terraform", cat: ToolingState, dirs: &[".terraform"], parent: &["*.tf"], selfm: NONE, conf: &[".terraform.lock.hcl"], regen: "terraform init", risk: Caution, rebuild: Low, net: Medium,
        desc: "Downloaded Terraform providers and modules, plus local backend and workspace state for this folder.",
        consequence: "`terraform init` must download providers and modules again. Local state or backend settings kept here are lost.", split: true },
    R { id: "unity-library", name: "Unity Library", eco: "Unity", cat: ToolCache, dirs: &["Library"], parent: &["ProjectSettings"], selfm: NONE, conf: &["Packages"], regen: "reopen the project (slow reimport)", risk: Caution, rebuild: High, net: Low,
        desc: "Unity's imported-asset cache. Unity rebuilds it when the project is reopened.",
        consequence: "Unity re-imports every asset the next time the project opens, which can take a long time.", split: true },
    R { id: "unity-temp", name: "Unity Temp / Obj", eco: "Unity", cat: BuildArtifact, dirs: &["Temp", "Obj", "obj"], parent: &["ProjectSettings"], selfm: NONE, conf: &["Packages"], regen: "reopen the project", risk: Safe, rebuild: Free, net: Free,
        desc: "Unity temporary files and intermediate build output.",
        consequence: "Unity recreates these when the project is open. Close Unity first.", split: false },
    R { id: "go-vendor", name: "Go vendor", eco: "Go", cat: ProjectDependency, dirs: &["vendor"], parent: &["go.mod"], selfm: &["modules.txt"], conf: &["go.sum"], regen: "go mod vendor", risk: Caution, rebuild: Low, net: Medium,
        desc: "Vendored Go dependencies.",
        consequence: "Builds that use `-mod=vendor` fail until you run `go mod vendor` again.", split: false },
    R { id: "php-vendor", name: "Composer vendor", eco: "PHP", cat: ProjectDependency, dirs: &["vendor"], parent: &["composer.json"], selfm: NONE, conf: &["composer.lock"], regen: "composer install", risk: Caution, rebuild: Medium, net: Medium,
        desc: "Composer dependencies.",
        consequence: "`composer install` must download the dependencies again before the app runs.", split: false },
    R { id: "ruby-vendor-bundle", name: "Bundler vendor/bundle", eco: "Ruby", cat: ProjectDependency, dirs: &["bundle"], parent: &["../Gemfile"], selfm: &["ruby"], conf: &["../Gemfile.lock"], regen: "bundle install", risk: Caution, rebuild: Medium, net: Medium,
        desc: "Gems Bundler installed into vendor/bundle for this project. Bundler settings in .bundle are not touched.",
        consequence: "`bundle install` must download and build the gems again.", split: false },
];

pub fn builtin_rules() -> Vec<Rule> {
    let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect();
    BUILTIN
        .iter()
        .map(|r| Rule {
            id: r.id.into(),
            version: RULES_VERSION,
            name: r.name.into(),
            ecosystem: r.eco.into(),
            category: r.cat,
            dir_names: v(r.dirs),
            parent_markers: v(r.parent),
            self_markers: v(r.selfm),
            confidence_markers: v(r.conf),
            // Unambiguous cache names are certain without markers; marker-based matches start high.
            base_confidence: Confidence::High,
            regenerates_with: r.regen.into(),
            description: r.desc.into(),
            consequence: r.consequence.into(),
            split: r.split,
            risk: r.risk,
            rebuild_cost: r.rebuild,
            network_cost: r.net,
            enabled: true,
            custom: false,
            confirmed: true,
        })
        .collect()
}

/// Custom rules are never trusted more than built-in ones: they start at medium confidence and
/// cannot claim Critical or Blocked; Danger needs the advanced setting.
pub fn sanitize_custom(mut r: Rule, allow_danger: bool) -> Rule {
    r.custom = true;
    r.base_confidence = r.base_confidence.min(Confidence::Medium);
    r.risk = match r.risk {
        Risk::Safe => Risk::Safe,
        Risk::Caution => Risk::Caution,
        _ if allow_danger => Risk::Danger,
        _ => Risk::Caution,
    };
    if r.category == Category::Unknown {
        r.category = Category::BuildArtifact;
    }
    if r.consequence.is_empty() {
        r.consequence = "Whatever created this folder has to create it again.".into();
    }
    r
}

/// Match `*.ext` style or exact names (optionally `../name`) against a directory listing.
pub fn marker_present(dir: &std::path::Path, marker: &str) -> bool {
    if let Some(ext) = marker.strip_prefix('*') {
        match std::fs::read_dir(dir) {
            Ok(rd) => rd.flatten().any(|e| e.file_name().to_string_lossy().ends_with(ext)),
            Err(_) => false,
        }
    } else if let Some(up) = marker.strip_prefix("../") {
        dir.parent().is_some_and(|p| p.join(up).exists())
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
        if !self.self_markers.is_empty() && !self.self_markers.iter().any(|m| marker_present(path, m)) {
            return false;
        }
        true
    }
}
