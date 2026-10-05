//! Try a custom rule before saving it: what would it match under the scan folders, how big is
//! that, and which matches would never be used because a built-in rule claims them first.
//! Nothing is selected or removed.

use crate::rules::{sanitize_custom, Rule};
use crate::safety;
use crate::scanner::{dir_stats, discover_with, project_root, ScanOptions};
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::AtomicBool;

/// Matches measured at most; the rest are only counted.
const MEASURE_LIMIT: usize = 500;
const SAMPLES: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleTestMatch {
    pub path: String,
    pub project: String,
    pub disk_bytes: u64,
    /// A built-in or other rule that claims this folder (or a folder around it) first; the test
    /// rule would not be used for it.
    pub claimed_by: Option<String>,
    /// A safety block that would apply regardless of the rule.
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RuleTestResult {
    pub matches: usize,
    /// Matches the rule would actually own (not claimed by another rule).
    pub effective: usize,
    pub total_bytes: u64,
    /// True when only the first matches were measured.
    pub partial_size: bool,
    pub samples: Vec<RuleTestMatch>,
    pub dirs_visited: u64,
    pub elapsed_ms: u64,
}

pub fn test_rule(rule: Rule, settings: &Settings, cancel: &AtomicBool) -> RuleTestResult {
    use rayon::prelude::*;
    let started = std::time::Instant::now();
    let mut rule = sanitize_custom(rule, settings.allow_danger_custom_rules);
    rule.enabled = true;
    let others: Vec<Rule> = settings.effective_rules().into_iter().filter(|r| r.enabled && r.id != rule.id).collect();
    let opts = ScanOptions {
        roots: settings.scan_roots.clone(),
        rules: vec![rule],
        exclude_names: settings.exclude_names.clone(),
        protected_paths: settings.protected_paths.clone(),
        max_depth: settings.max_depth,
        policy: settings.policy(),
        settings_hash: String::new(),
    };
    let d = discover_with(&opts, cancel, &|_| {});
    let measured: Vec<RuleTestMatch> = d
        .candidates
        .par_iter()
        .take(MEASURE_LIMIT)
        .map(|c| {
            let package = c.path.parent().unwrap_or(&c.path);
            let project = project_root(package, &c.root);
            RuleTestMatch {
                path: c.path.to_string_lossy().into_owned(),
                project: project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                disk_bytes: dir_stats(&c.path).disk_bytes,
                claimed_by: claimed_by(&c.path, &c.root, &others),
                blocked: safety::system_block(&c.path)
                    .map(|b| b.reason)
                    .or_else(|| safety::within_any(&c.path, &settings.protected_paths).map(|p| format!("Inside your protected path {}.", p.display()))),
            }
        })
        .collect();
    let effective = measured.iter().filter(|m| m.claimed_by.is_none()).count() + d.candidates.len().saturating_sub(MEASURE_LIMIT);
    let mut samples = measured.clone();
    samples.sort_by(|a, b| a.claimed_by.is_some().cmp(&b.claimed_by.is_some()).then(b.disk_bytes.cmp(&a.disk_bytes)));
    samples.truncate(SAMPLES);
    RuleTestResult {
        matches: d.candidates.len(),
        effective,
        total_bytes: measured.iter().filter(|m| m.claimed_by.is_none() && m.blocked.is_none()).map(|m| m.disk_bytes).sum(),
        partial_size: d.candidates.len() > MEASURE_LIMIT,
        samples,
        dirs_visited: d.dirs_visited,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

/// The first other rule that matches the folder itself or a folder above it (below the scan
/// folder). A real scan stops at that folder, so the test rule never sees this match.
fn claimed_by(path: &Path, root: &Path, others: &[Rule]) -> Option<String> {
    let mut d = Some(path);
    while let Some(x) = d {
        if x == root || !safety::is_within(x, root) {
            break;
        }
        if let Some(r) = others.iter().find(|r| r.matches(x)) {
            return Some(r.name.clone());
        }
        d = x.parent();
    }
    None
}
