//! User settings, persisted as JSON.

use crate::model::Confidence;
use crate::rules::{builtin_rules, sanitize_custom, Rule};
use crate::scanner::{ActivityMode, Policy};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io, path::{Path, PathBuf}};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeleteMode {
    Trash,
    Permanent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub scan_roots: Vec<PathBuf>,
    /// Directory names never entered while scanning (e.g. `.git`).
    pub exclude_names: Vec<String>,
    /// Paths (and everything under them) that can be listed but never deleted.
    pub protected_paths: Vec<PathBuf>,
    /// Per-rule enable overrides keyed by rule id.
    pub rule_enabled: BTreeMap<String, bool>,
    pub custom_rules: Vec<Rule>,
    pub delete_mode: DeleteMode,
    pub dry_run: bool,
    pub confirm_before_delete: bool,
    pub min_size_mb: u64,
    pub min_age_days: u64,
    pub max_depth: usize,
    pub theme: String,
    /// Start scanning as soon as the app opens.
    pub scan_on_launch: bool,
    /// Days after which items Dev Cleaner moved to the Trash are removed for good. 0 keeps them forever.
    pub trash_retention_days: u32,
    /// Show verdicts (Recommended / Review / Keep) and the quick-select buttons.
    pub recommendations_enabled: bool,
    /// Folders Git tracks cannot be selected. Off turns the block into a red warning.
    pub protect_git_tracked: bool,
    /// Look for keys, certificates and .env files (by name only) inside candidates.
    pub detect_sensitive_files: bool,
    /// Only detections at least this certain are recommended.
    pub minimum_recommendation_confidence: Confidence,
    /// What the Quick select button picks: "safe", "recommended" or "deep".
    pub default_cleanup_profile: String,
    /// How project activity is measured.
    pub activity_mode: ActivityMode,
    /// Warn when the scan is older than this many minutes when you clean.
    pub stale_scan_minutes: u32,
    /// Ask for a fresh scan when the current one is older than `stale_scan_minutes`.
    pub require_rescan_before_cleanup: bool,
    /// Advanced: custom rules may be marked dangerous.
    pub allow_danger_custom_rules: bool,
    /// Look for running processes and locked files that use a folder.
    pub detect_active_usage: bool,
    /// Show estimated reclaimable space.
    pub show_reclaim_estimate: bool,
    /// Show how much may have to be downloaded again.
    pub show_network_recovery_cost: bool,
    /// Scheduled scan and cleanup (off by default).
    pub schedule: crate::schedule::Schedule,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            scan_roots: dirs::home_dir().into_iter().collect(),
            exclude_names: [".git", ".Trash", "Library", "AppData", ".cache"]
                .iter().map(|s| s.to_string()).collect(),
            protected_paths: vec![],
            rule_enabled: BTreeMap::new(),
            custom_rules: vec![],
            delete_mode: DeleteMode::Trash,
            dry_run: false,
            confirm_before_delete: true,
            min_size_mb: 0,
            min_age_days: 0,
            max_depth: 8,
            theme: "system".into(),
            scan_on_launch: false,
            trash_retention_days: 30,
            recommendations_enabled: true,
            protect_git_tracked: true,
            detect_sensitive_files: true,
            minimum_recommendation_confidence: Confidence::High,
            default_cleanup_profile: "safe".into(),
            activity_mode: ActivityMode::Fast,
            stale_scan_minutes: 10,
            require_rescan_before_cleanup: false,
            allow_danger_custom_rules: false,
            detect_active_usage: true,
            show_reclaim_estimate: true,
            show_network_recovery_cost: true,
            schedule: crate::schedule::Schedule::default(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p)?;
        }
        fs::write(path, serde_json::to_string_pretty(self).map_err(io::Error::other)?)
    }

    /// Built-in plus custom rules with the user's enable overrides applied.
    pub fn effective_rules(&self) -> Vec<Rule> {
        let mut rules = builtin_rules();
        rules.extend(self.custom_rules.iter().cloned().map(|r| sanitize_custom(r, self.allow_danger_custom_rules)));
        for r in &mut rules {
            if let Some(e) = self.rule_enabled.get(&r.id) {
                r.enabled = *e;
            }
        }
        rules
    }

    /// Custom rules that have not been used in a real cleanup yet; their first cleanup asks for
    /// an explicit confirmation.
    pub fn unconfirmed_custom_rules(&self) -> Vec<String> {
        self.custom_rules.iter().filter(|r| !r.confirmed).map(|r| r.id.clone()).collect()
    }

    /// Inside a protected path, or containing one (component-aware, normalised).
    pub fn is_protected(&self, path: &Path) -> bool {
        crate::safety::within_any(path, &self.protected_paths).is_some() || crate::safety::contains_any(path, &self.protected_paths).is_some()
    }

    pub fn policy(&self) -> Policy {
        Policy {
            protect_git_tracked: self.protect_git_tracked,
            detect_sensitive_files: self.detect_sensitive_files,
            activity_mode: self.activity_mode,
            min_confidence: self.minimum_recommendation_confidence,
            detect_active_usage: self.detect_active_usage,
        }
    }

    /// Identifies the settings that affect scan results.
    pub fn hash(&self) -> String {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        std::hash::Hash::hash(&serde_json::to_string(self).unwrap_or_default(), &mut h);
        format!("{:016x}", std::hash::Hasher::finish(&h))
    }
}
