//! Shared vocabulary for classifying what a cleanup candidate is and how safe it is to remove.
//!
//! Every project folder and every global location is described with the same fields, so the
//! recommendation engine and the delete gates treat them the same way.

use serde::{Deserialize, Serialize};

/// How much it costs to lose this. Ordered from least to most dangerous.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// Regenerated automatically by the normal build step.
    #[serde(alias = "low")]
    Safe,
    /// Regenerated, but needs downloads or a long rebuild.
    #[serde(alias = "medium")]
    Caution,
    /// May lose meaningful local state, or break a tool until it is reinstalled.
    #[serde(alias = "high")]
    Danger,
    /// Potential permanent data loss (emulators, simulators, archives, signing material).
    Critical,
    /// Dev Cleaner will not remove it.
    Blocked,
}

impl Default for Risk {
    fn default() -> Self {
        Risk::Safe
    }
}

/// What kind of thing a folder is. Rebuildable does not mean safe: the category says what is lost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    BuildArtifact,
    ProjectDependency,
    PackageCache,
    ToolCache,
    Sdk,
    Toolchain,
    IdeCache,
    ToolingState,
    ProjectConfiguration,
    VirtualEnvironment,
    DeviceData,
    Archive,
    TempData,
    SystemData,
    Unknown,
}

impl Category {
    /// Group label used to organise the Tools & SDKs screen.
    pub fn group(self) -> &'static str {
        match self {
            Category::BuildArtifact | Category::PackageCache | Category::ToolCache | Category::ProjectDependency => "Package & build caches",
            Category::Sdk | Category::Toolchain => "SDKs & toolchains",
            Category::IdeCache => "IDE caches",
            Category::DeviceData | Category::Archive => "Developer state",
            Category::TempData => "Temporary data",
            Category::SystemData => "View only",
            Category::ToolingState | Category::ProjectConfiguration | Category::VirtualEnvironment | Category::Unknown => "Other",
        }
    }

    /// Share of the measured size that may have to be downloaded again (a rough planning number).
    pub fn download_factor(self) -> f64 {
        match self {
            Category::PackageCache => 1.0,
            Category::Sdk | Category::Toolchain => 0.6,
            Category::ProjectDependency | Category::VirtualEnvironment => 0.5,
            _ => 0.0,
        }
    }
}

/// Rebuild time or download volume needed to get something back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cost {
    /// Nothing (rebuild cost: seconds; network: no downloads).
    None,
    Low,
    Medium,
    High,
    VeryHigh,
    Unknown,
}

/// How sure Dev Cleaner is that a folder is what the rule says it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Unknown,
    Low,
    Medium,
    High,
    VeryHigh,
}

impl Confidence {
    pub fn up(self) -> Confidence {
        match self {
            Confidence::Unknown => Confidence::Low,
            Confidence::Low => Confidence::Medium,
            Confidence::Medium => Confidence::High,
            _ => Confidence::VeryHigh,
        }
    }
    pub fn down(self) -> Confidence {
        match self {
            Confidence::VeryHigh => Confidence::High,
            Confidence::High => Confidence::Medium,
            Confidence::Medium => Confidence::Low,
            _ => Confidence::Unknown,
        }
    }
}

/// Git's view of a folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitStatus {
    /// Matched by .gitignore. Raises confidence, but does not prove the contents are disposable.
    Ignored,
    /// Git tracks files inside it, and they are unchanged.
    Tracked,
    /// Git tracks files inside it and some have uncommitted changes.
    Modified,
    /// Inside a repository, neither ignored nor tracked.
    Untracked,
    /// Git is missing or failed.
    Unknown,
    NotRepository,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Worth knowing before you delete.
    Caution,
    /// Deleting may lose data that cannot be recreated, or break something that is required.
    Danger,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Warning {
    pub level: Level,
    pub message: String,
}

impl Warning {
    pub fn caution(m: impl Into<String>) -> Warning {
        Warning { level: Level::Caution, message: m.into() }
    }
    pub fn danger(m: impl Into<String>) -> Warning {
        Warning { level: Level::Danger, message: m.into() }
    }
}

/// Who decided that something must not be removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockSource {
    /// One of the user's protected paths.
    User,
    /// A hard-coded system or personal folder.
    System,
    /// Git tracks files inside it.
    Git,
    /// Signing keys or similar were found inside.
    Sensitive,
    /// The rule or location itself says so (view-only data, the active tool version, ...).
    Rule,
}

/// Why an item cannot be selected. Enforced again by the backend at delete time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub source: BlockSource,
    pub reason: String,
}

impl Block {
    pub fn new(source: BlockSource, reason: impl Into<String>) -> Block {
        Block { source, reason: reason.into() }
    }
}

/// One line of "why was this found" or "why (not) recommended": `ok` lines support cleaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reason {
    pub ok: bool,
    pub text: String,
}

impl Reason {
    pub fn yes(t: impl Into<String>) -> Reason {
        Reason { ok: true, text: t.into() }
    }
    pub fn no(t: impl Into<String>) -> Reason {
        Reason { ok: false, text: t.into() }
    }
}

/// The recommendation engine's verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Evidence says it is safe and worthwhile.
    Recommended,
    /// Probably fine, but has a cost or something to check.
    Review,
    /// Keep it.
    Keep,
    /// Cannot be removed.
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recommendation {
    pub verdict: Verdict,
    /// 0..=100, higher is a better cleanup candidate. Always shown with its reasons.
    pub score: u8,
    pub reasons: Vec<Reason>,
}

impl Default for Recommendation {
    fn default() -> Self {
        Recommendation { verdict: Verdict::Review, score: 0, reasons: vec![] }
    }
}

/// Is a shared SDK/toolchain version used by a scanned project?
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Usage {
    /// Referenced by these projects.
    Used { by: Vec<String> },
    /// No scanned project references it.
    Unused { projects_checked: usize },
    /// Cannot tell (no project scan yet, or the reference cannot be read).
    Unknown,
}

/// Metadata captured at scan time and compared again right before deleting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Fingerprint {
    pub canonical: String,
    /// Inode (unix) or 0 where unavailable.
    pub file_id: u64,
    pub device: u64,
    /// Modification time of the folder itself (changes when entries are added or removed).
    pub mtime: u64,
    pub is_dir: bool,
}
