//! Which projects use which installed SDK, toolchain and Gradle versions.
//!
//! Built from the last complete project scan (the versions each project asks for) and the last
//! global scan (the versions installed). Shows versions nothing uses, and versions projects ask
//! for that are not installed.

use crate::global::GlobalCache;
use crate::references::{key_label, key_matches, Refs, REFERENCED_LOCATIONS};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionNode {
    /// Part id when installed, otherwise "missing:<location>:<version>".
    pub id: String,
    pub location_id: String,
    pub location: String,
    pub label: String,
    pub installed: bool,
    pub bytes: u64,
    /// Projects that ask for it.
    pub projects: Vec<String>,
    /// Set when a safety rule keeps this version (e.g. the default toolchain).
    pub kept: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationGroup {
    pub id: String,
    pub name: String,
    pub ecosystem: String,
    pub versions: Vec<VersionNode>,
    /// Projects that do not pin a version here, so usage is uncertain.
    pub unpinned: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DependencyGraph {
    /// False until a complete project scan has run.
    pub has_projects: bool,
    /// False until the Tools & SDKs scan has run.
    pub has_globals: bool,
    pub projects_checked: usize,
    pub groups: Vec<LocationGroup>,
    /// Every project that appears in an edge, sorted.
    pub projects: Vec<String>,
    pub unused_bytes: u64,
}

pub fn build(refs: Option<&Refs>, caches: &[GlobalCache]) -> DependencyGraph {
    let mut g = DependencyGraph { has_projects: refs.is_some(), has_globals: !caches.is_empty(), projects_checked: refs.map(|r| r.projects).unwrap_or(0), ..Default::default() };
    let empty = Refs::default();
    let refs = refs.unwrap_or(&empty);
    let mut all_projects = BTreeSet::new();
    for c in caches.iter().filter(|c| REFERENCED_LOCATIONS.iter().any(|l| c.id.starts_with(l))) {
        let Some((map, unpinned)) = refs.family(&c.id) else { continue };
        let mut versions: Vec<VersionNode> = c
            .parts
            .iter()
            .map(|p| {
                let projects: BTreeSet<String> = map.iter().filter(|(k, _)| key_matches(&c.id, k, &p.name)).flat_map(|(_, v)| v.iter().cloned()).collect();
                VersionNode {
                    id: p.id.clone(),
                    location_id: c.id.clone(),
                    location: c.name.clone(),
                    label: p.name.clone(),
                    installed: true,
                    bytes: p.disk_bytes,
                    projects: projects.into_iter().collect(),
                    kept: p.block.as_ref().map(|b| b.reason.clone()).or_else(|| p.warning.as_ref().filter(|w| w.level == crate::model::Level::Danger).map(|w| w.message.clone())),
                }
            })
            .collect();
        for (key, projects) in map {
            if !c.parts.iter().any(|p| key_matches(&c.id, key, &p.name)) {
                versions.push(VersionNode {
                    id: format!("missing:{}:{key}", c.id),
                    location_id: c.id.clone(),
                    location: c.name.clone(),
                    label: key_label(&c.id, key),
                    installed: false,
                    bytes: 0,
                    projects: projects.iter().cloned().collect(),
                    kept: None,
                });
            }
        }
        // Several fvm locations share one reference map: only list a missing version once.
        if c.id.starts_with("fvm-versions") && g.groups.iter().any(|x| x.id.starts_with("fvm-versions")) {
            versions.retain(|v| v.installed);
        }
        versions.sort_by(|a, b| b.installed.cmp(&a.installed).then(a.projects.is_empty().cmp(&b.projects.is_empty())).then(b.bytes.cmp(&a.bytes)));
        for v in &versions {
            all_projects.extend(v.projects.iter().cloned());
            if v.installed && v.projects.is_empty() && v.kept.is_none() && g.has_projects && unpinned.is_none_or(|u| u.is_empty()) {
                g.unused_bytes += v.bytes;
            }
        }
        if versions.is_empty() {
            continue;
        }
        g.groups.push(LocationGroup {
            id: c.id.clone(),
            name: c.name.clone(),
            ecosystem: c.ecosystem.clone(),
            versions,
            unpinned: unpinned.map(|u| u.iter().cloned().collect()).unwrap_or_default(),
        });
    }
    g.projects = all_projects.into_iter().collect();
    g
}
