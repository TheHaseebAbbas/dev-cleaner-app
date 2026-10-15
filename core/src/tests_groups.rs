//! Tests for the three groups the screens show: Safe to clean, Worth a look, Leaving alone.

use crate::model::*;
use crate::recommend::{group, GroupFacts};
use crate::rules::builtin_rules;
use crate::scanner::*;
use std::{fs, path::Path, sync::atomic::AtomicBool};

fn rec(verdict: Verdict) -> Recommendation {
    Recommendation { verdict, score: 50, reasons: vec![] }
}

fn facts(r: Option<&Recommendation>) -> GroupFacts<'_> {
    GroupFacts { recommendation: r, risk: Risk::Safe, blocked: false, view_only: false, whole_selectable: true, in_use: false, warnings: 0 }
}

#[test]
fn only_a_clean_recommendation_is_safe() {
    let r = rec(Verdict::Recommended);
    assert_eq!(group(&facts(Some(&r))), CleanGroup::Safe);
    assert_eq!(group(&GroupFacts { in_use: true, ..facts(Some(&r)) }), CleanGroup::Look);
    assert_eq!(group(&GroupFacts { warnings: 1, ..facts(Some(&r)) }), CleanGroup::Look);
    assert_eq!(group(&GroupFacts { whole_selectable: false, ..facts(Some(&r)) }), CleanGroup::Look);
    assert_eq!(group(&facts(Some(&rec(Verdict::Review)))), CleanGroup::Look);
}

#[test]
fn blocks_unknowns_and_critical_risk_fail_closed() {
    let r = rec(Verdict::Recommended);
    assert_eq!(group(&GroupFacts { blocked: true, ..facts(Some(&r)) }), CleanGroup::Leave);
    assert_eq!(group(&GroupFacts { view_only: true, ..facts(Some(&r)) }), CleanGroup::Leave);
    assert_eq!(group(&GroupFacts { risk: Risk::Critical, ..facts(Some(&r)) }), CleanGroup::Leave);
    assert_eq!(group(&facts(None)), CleanGroup::Leave);
    assert_eq!(group(&facts(Some(&rec(Verdict::Keep)))), CleanGroup::Leave);
    assert_eq!(group(&facts(Some(&rec(Verdict::Blocked)))), CleanGroup::Leave);
    assert_eq!(CleanGroup::default(), CleanGroup::Leave);
}

#[test]
fn scanned_items_carry_their_group() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    for (f, n) in [("web/package.json", 5), ("web/node_modules/a.js", 100)] {
        let p = r.join(f);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, vec![b'x'; n]).unwrap();
    }
    let o = ScanOptions { roots: vec![r.to_path_buf()], rules: builtin_rules(), exclude_names: vec![".git".into()], protected_paths: vec![], max_depth: 10, policy: Policy::default(), settings_hash: String::new() };
    let items = scan(&o, &AtomicBool::new(false), |_| {});
    let i = items.iter().find(|i| Path::new(&i.path).ends_with("node_modules")).unwrap();
    // Just changed, so never Safe to clean; and the group matches what the engine decided.
    assert_ne!(i.recommendation.verdict, Verdict::Recommended);
    assert_eq!(i.clean_group, CleanGroup::Look);
    let json = serde_json::to_value(i).unwrap();
    assert_eq!(json["clean_group"], "look");
}
