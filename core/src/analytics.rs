//! "Over time": a small summary of what Dev Cleaner has reclaimed, computed from the History
//! log and the scan log. Kept deliberately small; it is not a dashboard.

use crate::history::{HistoryEntry, ScanRecord};
use crate::model::Category;
use crate::cleaner::OutcomeKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Month {
    /// "2026-10" (UTC).
    pub month: String,
    pub bytes: u64,
    pub folders: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Share {
    pub key: String,
    pub bytes: u64,
    pub folders: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanPoint {
    pub timestamp: u64,
    pub reclaimable_bytes: u64,
    pub items: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Analytics {
    /// The last `months` calendar months, oldest first, including empty ones.
    pub months: Vec<Month>,
    /// Reclaimed per kind of folder, largest first.
    pub by_category: Vec<Share>,
    /// Reclaimed per rule, largest first (at most 8).
    pub by_rule: Vec<Share>,
    /// Reclaimable space found by recent complete project scans, oldest first.
    pub scans: Vec<ScanPoint>,
}

/// (year, month) of a unix timestamp in UTC.
pub fn year_month(ts: u64) -> (i64, u32) {
    // Howard Hinnant's civil-from-days.
    let z = (ts / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m)
}

pub fn compute(history: &[HistoryEntry], scans: &[ScanRecord], now: u64, months: usize) -> Analytics {
    let (mut y, mut m) = year_month(now);
    let mut keys = vec![];
    for _ in 0..months.max(1) {
        keys.push(format!("{y:04}-{m:02}"));
        if m == 1 {
            y -= 1;
            m = 12;
        } else {
            m -= 1;
        }
    }
    keys.reverse();
    let mut per: BTreeMap<String, Month> = keys.iter().map(|k| (k.clone(), Month { month: k.clone(), ..Default::default() })).collect();
    let mut cat: BTreeMap<String, Share> = BTreeMap::new();
    let mut rule: BTreeMap<String, Share> = BTreeMap::new();
    for h in history.iter().filter(|h| h.result == OutcomeKind::Removed) {
        let (yy, mm) = year_month(h.timestamp);
        if let Some(e) = per.get_mut(&format!("{yy:04}-{mm:02}")) {
            e.bytes += h.estimated_reclaimed;
            e.folders += 1;
        }
        let c = serde_json::to_value(h.category.unwrap_or(Category::Unknown)).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        for (map, key) in [(&mut cat, c), (&mut rule, if h.rule_id.is_empty() { "unknown".into() } else { h.rule_id.clone() })] {
            let s = map.entry(key.clone()).or_insert_with(|| Share { key, ..Default::default() });
            s.bytes += h.estimated_reclaimed;
            s.folders += 1;
        }
    }
    let sorted = |m: BTreeMap<String, Share>| {
        let mut v: Vec<Share> = m.into_values().collect();
        v.sort_by(|a, b| b.bytes.cmp(&a.bytes));
        v
    };
    let mut by_rule = sorted(rule);
    by_rule.truncate(8);
    let mut pts: Vec<ScanPoint> = scans
        .iter()
        .filter(|s| s.kind == "projects" && s.complete)
        .map(|s| ScanPoint { timestamp: s.timestamp, reclaimable_bytes: s.reclaimable_bytes, items: s.item_count })
        .collect();
    pts.sort_by_key(|p| p.timestamp);
    let skip = pts.len().saturating_sub(20);
    Analytics { months: per.into_values().collect(), by_category: sorted(cat), by_rule, scans: pts.split_off(skip) }
}
