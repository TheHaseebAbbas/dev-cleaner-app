//! Deterministic, explainable cleanup recommendations.
//!
//! Every verdict comes with the reasons behind it, and the score only orders candidates. The
//! rules are conservative: anything blocked, critical, tracked by Git, in use by a project, or
//! detected with low confidence is never recommended.

use crate::global::GlobalCache;
use crate::model::{Block, Category, CleanGroup, Confidence, Cost, GitStatus, Level, Reason, Recommendation, Risk, Usage, Verdict, Warning};
use crate::scanner::{Item, Part};

/// Everything the engine looks at. Built by the project and global scanners.
pub struct Facts<'a> {
    pub risk: Risk,
    pub category: Category,
    pub confidence: Confidence,
    pub min_confidence: Confidence,
    pub block: Option<&'a Block>,
    pub git: GitStatus,
    pub reclaimable: u64,
    /// Days since anything inside changed.
    pub idle_days: Option<u64>,
    /// Days since the owning project changed (project folders only).
    pub project_idle_days: Option<u64>,
    pub rebuild_cost: Cost,
    pub network_cost: Cost,
    pub download_bytes: u64,
    pub warnings: &'a [Warning],
    pub usage: Option<&'a Usage>,
}

/// Days of inactivity after which a costly-but-rebuildable cache becomes a good candidate.
pub const OLD_DAYS: u64 = 30;
/// A project changed more recently than this is probably being worked on.
pub const RECENT_DAYS: u64 = 3;

pub fn fmt_bytes(n: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < units.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{n} B") } else if v >= 100.0 { format!("{v:.0} {}", units[i]) } else { format!("{v:.1} {}", units[i]) }
}

fn days(n: u64) -> String {
    match n {
        0 => "today".into(),
        1 => "1 day".into(),
        n => format!("{n} days"),
    }
}

pub fn confidence_label(c: Confidence) -> &'static str {
    match c {
        Confidence::VeryHigh => "Very high",
        Confidence::High => "High",
        Confidence::Medium => "Medium",
        Confidence::Low => "Low",
        Confidence::Unknown => "Unknown",
    }
}

pub fn recommend(f: &Facts) -> Recommendation {
    if let Some(b) = f.block {
        return Recommendation { verdict: Verdict::Blocked, score: 0, reasons: vec![Reason::no(b.reason.clone())] };
    }
    let mut r: Vec<Reason> = vec![];
    let mut score: i32 = 0;

    // Benefit
    let mb = f.reclaimable as f64 / 1_048_576.0;
    score += ((30.0 * (1.0 + mb).log10() / (1.0 + 10_240.0f64).log10()).min(30.0)) as i32;
    if mb >= 1.0 {
        r.push(Reason::yes(format!("Frees about {}", fmt_bytes(f.reclaimable))));
    } else {
        r.push(Reason::no(format!("Small ({})", fmt_bytes(f.reclaimable))));
    }

    // What is lost
    match f.risk {
        Risk::Safe => {
            score += 20;
            r.push(Reason::yes("Rebuilt automatically by your tools"));
        }
        Risk::Caution => {
            score += 10;
            r.push(Reason::yes("Can be recreated"));
        }
        Risk::Danger => {
            score += 2;
            r.push(Reason::no("Can lose local state or break a tool until it is reinstalled"));
        }
        Risk::Critical | Risk::Blocked => r.push(Reason::no("Holds data that cannot be recreated automatically")),
    }
    score += match f.rebuild_cost {
        Cost::None => 20,
        Cost::Low => 16,
        Cost::Medium => 10,
        Cost::High => 5,
        Cost::VeryHigh => 0,
        Cost::Unknown => 8,
    };
    if f.rebuild_cost >= Cost::High && f.rebuild_cost != Cost::Unknown {
        r.push(Reason::no("Slow to rebuild"));
    }
    if f.network_cost >= Cost::Medium && f.network_cost != Cost::Unknown && f.download_bytes > 0 {
        r.push(Reason::no(format!("May need to download up to {} again", fmt_bytes(f.download_bytes))));
        score -= match f.network_cost {
            Cost::Medium => 3,
            Cost::High => 6,
            _ => 10,
        };
    }

    // Evidence
    let low_confidence = f.confidence < f.min_confidence;
    score += match f.confidence {
        Confidence::VeryHigh => 10,
        Confidence::High => 8,
        Confidence::Medium => 4,
        _ => 0,
    };
    if low_confidence {
        r.push(Reason::no(format!("{} detection confidence", confidence_label(f.confidence))));
    } else {
        r.push(Reason::yes(format!("{} detection confidence", confidence_label(f.confidence))));
    }
    let tracked = matches!(f.git, GitStatus::Tracked | GitStatus::Modified);
    match f.git {
        GitStatus::Ignored => r.push(Reason::yes("Git ignores it")),
        GitStatus::Untracked => {
            score -= 5;
            r.push(Reason::no("Not listed in .gitignore"));
        }
        GitStatus::Tracked => r.push(Reason::no("Git tracks files inside it")),
        GitStatus::Modified => r.push(Reason::no("Git tracks files inside it and some have uncommitted changes")),
        _ => {}
    }

    // Activity
    let old = f.idle_days.is_some_and(|d| d >= OLD_DAYS);
    if let Some(d) = f.idle_days {
        score += (d.min(90) * 20 / 90) as i32;
        if old {
            r.push(Reason::yes(format!("Not changed for {}", days(d))));
        }
    }
    let recent = f.project_idle_days.is_some_and(|d| d < RECENT_DAYS);
    if recent {
        score -= 15;
        let d = f.project_idle_days.unwrap_or(0);
        let when = if d == 0 { "today".to_string() } else { format!("{} ago", days(d)) };
        r.push(Reason::no(format!("Project changed {when}; you may be working on it")));
    }

    // References
    let used = matches!(f.usage, Some(Usage::Used { .. }));
    let unused = matches!(f.usage, Some(Usage::Unused { .. }));
    match f.usage {
        Some(Usage::Used { by }) => {
            score -= 20;
            let shown: Vec<&str> = by.iter().take(3).map(String::as_str).collect();
            let more = by.len().saturating_sub(3);
            r.push(Reason::no(format!("Used by {}{}", shown.join(", "), if more > 0 { format!(" and {more} more") } else { String::new() })));
        }
        Some(Usage::Unused { projects_checked }) => {
            score += 10;
            r.push(Reason::yes(format!("Not used by any of the {projects_checked} scanned projects")));
        }
        _ => {}
    }

    let danger_warning = f.warnings.iter().any(|w| w.level == Level::Danger);
    if danger_warning {
        score -= 20;
    }
    let verdict = if f.risk >= Risk::Critical || tracked || used || danger_warning {
        Verdict::Keep
    } else if f.risk == Risk::Danger {
        if unused { Verdict::Review } else { Verdict::Keep }
    } else if low_confidence || recent {
        Verdict::Review
    } else if f.risk == Risk::Safe {
        Verdict::Recommended
    } else if (old || unused) && f.rebuild_cost < Cost::VeryHigh {
        Verdict::Recommended
    } else {
        Verdict::Review
    };
    if verdict == Verdict::Review && f.risk == Risk::Caution && !old && !unused {
        r.push(Reason::no(format!("Changed in the last {OLD_DAYS} days")));
    }
    let mut score = score.clamp(0, 100);
    if verdict == Verdict::Keep {
        score = score.min(30);
    }
    Recommendation { verdict, score: score as u8, reasons: r }
}

/// What the grouping looks at, for a project folder, a Tools & SDKs location or one of their parts.
pub struct GroupFacts<'a> {
    pub recommendation: Option<&'a Recommendation>,
    pub risk: Risk,
    pub blocked: bool,
    /// Shown but never removed (Docker, WSL).
    pub view_only: bool,
    /// Can be ticked as a whole: no blocked part, not parts-only.
    pub whole_selectable: bool,
    pub in_use: bool,
    pub warnings: usize,
}

/// The one place that decides Safe to clean, Worth a look or Leaving alone. Fails closed: a block,
/// a missing verdict, Keep or Critical risk is Leaving alone, whatever else says otherwise.
pub fn group(g: &GroupFacts) -> CleanGroup {
    if g.view_only || g.blocked {
        return CleanGroup::Leave;
    }
    let Some(r) = g.recommendation else { return CleanGroup::Leave };
    if matches!(r.verdict, Verdict::Keep | Verdict::Blocked) || g.risk >= Risk::Critical {
        return CleanGroup::Leave;
    }
    if !g.whole_selectable || r.verdict == Verdict::Review || g.in_use || g.warnings > 0 {
        return CleanGroup::Look;
    }
    CleanGroup::Safe
}

fn busy(u: &Option<crate::inuse::ActiveUse>) -> bool {
    u.as_ref().is_some_and(|u| u.in_use())
}

fn group_parts(parts: &mut [Part], owner_risk: Risk, owner_blocked: bool, view_only: bool, owner_warnings: usize) {
    for p in parts.iter_mut() {
        p.clean_group = group(&GroupFacts {
            recommendation: p.recommendation.as_ref(),
            risk: p.risk.unwrap_or(owner_risk),
            blocked: owner_blocked || p.block.is_some(),
            view_only,
            whole_selectable: true,
            in_use: busy(&p.in_use),
            warnings: owner_warnings + usize::from(p.warning.is_some()),
        });
    }
}

/// Sets the group on a project folder and its parts. Call once everything else is known.
pub fn group_item(i: &mut Item) {
    group_parts(&mut i.parts, i.risk, i.block.is_some(), false, i.warnings.len());
    i.clean_group = group(&GroupFacts {
        recommendation: Some(&i.recommendation),
        risk: i.risk,
        blocked: i.block.is_some(),
        view_only: false,
        whole_selectable: !i.parts.iter().any(|p| p.block.is_some()),
        in_use: busy(&i.in_use),
        warnings: i.warnings.len(),
    });
}

/// Sets the group on a Tools & SDKs location and its parts.
pub fn group_cache(c: &mut GlobalCache) {
    group_parts(&mut c.parts, c.risk, c.block.is_some(), c.info_only, c.warnings.len());
    c.clean_group = group(&GroupFacts {
        recommendation: Some(&c.recommendation),
        risk: c.risk,
        blocked: c.block.is_some(),
        view_only: c.info_only,
        whole_selectable: !c.parts_only && !c.parts.iter().any(|p| p.block.is_some()),
        in_use: busy(&c.in_use),
        warnings: c.warnings.len(),
    });
}
