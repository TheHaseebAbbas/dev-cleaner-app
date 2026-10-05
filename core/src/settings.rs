//! User settings, persisted as JSON.

use crate::rules::{builtin_rules, Rule};
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
        rules.extend(self.custom_rules.iter().cloned().map(|mut r| {
            r.custom = true;
            r
        }));
        for r in &mut rules {
            if let Some(e) = self.rule_enabled.get(&r.id) {
                r.enabled = *e;
            }
        }
        rules
    }

    pub fn is_protected(&self, path: &Path) -> bool {
        self.protected_paths.iter().any(|p| path.starts_with(p))
    }
}
