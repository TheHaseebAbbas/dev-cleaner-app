//! Which SDK, toolchain and Gradle versions the scanned projects actually use.
//!
//! Collected from files the project scan walks past anyway (no extra directory walk), then used
//! to mark global parts as used, unused or unknown.

use crate::model::Usage;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// File names worth reading for references.
pub const REFERENCE_FILES: &[&str] = &["rust-toolchain", "rust-toolchain.toml", ".fvmrc", "fvm_config.json", "build.gradle", "build.gradle.kts", "gradle-wrapper.properties"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Refs {
    /// Number of distinct projects the references were collected from.
    pub projects: usize,
    pub rust: BTreeMap<String, BTreeSet<String>>,
    pub android_platforms: BTreeMap<String, BTreeSet<String>>,
    pub android_build_tools: BTreeMap<String, BTreeSet<String>>,
    pub android_ndk: BTreeMap<String, BTreeSet<String>>,
    /// Android projects whose compile SDK comes from Flutter or another indirection.
    pub android_platform_unpinned: BTreeSet<String>,
    /// Android projects that let the Gradle plugin pick build-tools.
    pub android_build_tools_unpinned: BTreeSet<String>,
    /// Android projects that let Flutter or the Gradle plugin pick the NDK.
    pub android_ndk_unpinned: BTreeSet<String>,
    pub fvm: BTreeMap<String, BTreeSet<String>>,
    pub gradle: BTreeMap<String, BTreeSet<String>>,
}

fn quoted(s: &str) -> Option<String> {
    let a = s.find(['"', '\''])?;
    let rest = &s[a + 1..];
    let b = rest.find(['"', '\''])?;
    Some(rest[..b].to_string())
}

fn first_int(s: &str) -> Option<String> {
    let d: String = s.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    (!d.is_empty()).then_some(d)
}

/// Value after `key` on a line, if the line sets that key.
fn setting<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let t = line.trim_start();
    let rest = t.strip_prefix(key)?;
    let next = rest.chars().next()?;
    (next.is_whitespace() || next == '=' || next == '(').then_some(rest)
}

impl Refs {
    fn add(map: &mut BTreeMap<String, BTreeSet<String>>, key: String, project: &str) {
        map.entry(key).or_default().insert(project.to_string());
    }

    /// Read one reference file belonging to `project` (the project's display name).
    pub fn read_file(&mut self, file: &Path, project: &str) {
        let Some(name) = file.file_name().map(|n| n.to_string_lossy().into_owned()) else { return };
        let Ok(text) = std::fs::read_to_string(file) else { return };
        match name.as_str() {
            "rust-toolchain" | "rust-toolchain.toml" => {
                let channel = text.lines().find_map(|l| setting(l, "channel").and_then(quoted)).or_else(|| {
                    let t = text.trim();
                    (!t.is_empty() && !t.contains('[') && !t.contains('\n')).then(|| t.to_string())
                });
                if let Some(c) = channel {
                    Self::add(&mut self.rust, c, project);
                }
            }
            ".fvmrc" | "fvm_config.json" => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(s) = v.get("flutter").or_else(|| v.get("flutterSdkVersion")).and_then(|x| x.as_str()) {
                        Self::add(&mut self.fvm, s.to_string(), project);
                    }
                }
            }
            "gradle-wrapper.properties" => {
                if let Some(url) = text.lines().find_map(|l| l.trim().strip_prefix("distributionUrl")) {
                    if let Some(i) = url.find("gradle-") {
                        let v = &url[i + 7..];
                        let end = v.find("-bin").or_else(|| v.find("-all")).unwrap_or(v.len());
                        Self::add(&mut self.gradle, v[..end].to_string(), project);
                    }
                }
            }
            "build.gradle" | "build.gradle.kts" => {
                let (mut compile, mut tools, mut ndk, mut android) = (None, None, None, false);
                let mut compile_indirect = false;
                let mut ndk_indirect = false;
                for l in text.lines() {
                    for key in ["compileSdkVersion", "compileSdk"] {
                        if let Some(v) = setting(l, key) {
                            android = true;
                            match first_int(v) {
                                Some(n) => compile = Some(n),
                                None => compile_indirect = true,
                            }
                            break;
                        }
                    }
                    if let Some(v) = setting(l, "buildToolsVersion") {
                        tools = quoted(v);
                    }
                    if let Some(v) = setting(l, "ndkVersion") {
                        match quoted(v) {
                            Some(q) => ndk = Some(q),
                            None => ndk_indirect = true,
                        }
                    }
                }
                if !android {
                    return;
                }
                match compile {
                    Some(n) => Self::add(&mut self.android_platforms, n, project),
                    None if compile_indirect => {
                        self.android_platform_unpinned.insert(project.into());
                    }
                    None => {}
                }
                match tools {
                    Some(t) => Self::add(&mut self.android_build_tools, t, project),
                    None => {
                        self.android_build_tools_unpinned.insert(project.into());
                    }
                }
                match ndk {
                    Some(n) => Self::add(&mut self.android_ndk, n, project),
                    None if ndk_indirect => {
                        self.android_ndk_unpinned.insert(project.into());
                    }
                    None => {}
                }
            }
            _ => {}
        }
    }

    /// Collect from `(file, project name)` pairs.
    pub fn collect(files: &[(PathBuf, String)], projects: usize) -> Refs {
        let mut r = Refs { projects, ..Default::default() };
        for (f, p) in files {
            r.read_file(f, p);
        }
        r
    }

    fn usage(&self, map: &BTreeMap<String, BTreeSet<String>>, matches: impl Fn(&str) -> bool, unpinned: Option<&BTreeSet<String>>) -> Usage {
        let by: BTreeSet<String> = map.iter().filter(|(k, _)| matches(k)).flat_map(|(_, v)| v.iter().cloned()).collect();
        if !by.is_empty() {
            return Usage::Used { by: by.into_iter().collect() };
        }
        if unpinned.is_some_and(|u| !u.is_empty()) || self.projects == 0 {
            return Usage::Unknown;
        }
        Usage::Unused { projects_checked: self.projects }
    }

    /// Usage of one part of a global location, or `None` when the location has no references.
    pub fn usage_of(&self, cache_id: &str, part: &str) -> Option<Usage> {
        let (map, unpinned) = self.family(cache_id)?;
        Some(self.usage(map, |k| key_matches(cache_id, k, part), unpinned))
    }

    /// The versions projects ask for in one global location, and the projects that do not pin one.
    pub fn family(&self, cache_id: &str) -> Option<(&BTreeMap<String, BTreeSet<String>>, Option<&BTreeSet<String>>)> {
        Some(match cache_id {
            "rustup-toolchains" => (&self.rust, None),
            "android-platforms" => (&self.android_platforms, Some(&self.android_platform_unpinned)),
            "android-build-tools" => (&self.android_build_tools, Some(&self.android_build_tools_unpinned)),
            "android-ndk" => (&self.android_ndk, Some(&self.android_ndk_unpinned)),
            id if id.starts_with("fvm-versions") => (&self.fvm, None),
            "gradle-wrapper" => (&self.gradle, None),
            _ => return None,
        })
    }
}

/// Global locations whose parts are matched against project references.
pub const REFERENCED_LOCATIONS: &[&str] = &["rustup-toolchains", "android-platforms", "android-build-tools", "android-ndk", "fvm-versions", "gradle-wrapper"];

/// Does a version a project asks for (`key`) name this installed part?
pub fn key_matches(cache_id: &str, key: &str, part: &str) -> bool {
    match cache_id {
        "rustup-toolchains" => part == key || part.starts_with(&format!("{key}-")),
        "android-platforms" => part.strip_prefix("android-").and_then(first_int).is_some_and(|l| l == key),
        "android-build-tools" | "android-ndk" => part == key,
        id if id.starts_with("fvm-versions") => part == key || part.starts_with(&format!("{key}@")),
        "gradle-wrapper" => part.starts_with(&format!("gradle-{key}-")),
        _ => false,
    }
}

/// How a requested version is shown when it is not installed.
pub fn key_label(cache_id: &str, key: &str) -> String {
    match cache_id {
        "android-platforms" => format!("android-{key}"),
        "gradle-wrapper" => format!("Gradle {key}"),
        id if id.starts_with("fvm-versions") => format!("Flutter {key}"),
        _ => key.to_string(),
    }
}
