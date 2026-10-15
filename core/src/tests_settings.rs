//! Upgrading to the simpler settings keeps every value, and the Advanced switch never changes
//! what a scan finds or what can be deleted.

use crate::rules::builtin_rules;
use crate::settings::{DeleteMode, Settings};
use std::path::PathBuf;

/// Settings with every field moved off its default, as a 1.x user might have them.
fn customised() -> Settings {
    let mut custom = builtin_rules().remove(0);
    custom.id = "custom-1".into();
    custom.name = "My build".into();
    custom.custom = true;
    let mut s = Settings {
        scan_roots: vec![PathBuf::from("/home/me/code"), PathBuf::from("/work")],
        exclude_names: vec![".git".into(), "archive".into()],
        protected_paths: vec![PathBuf::from("/home/me/code/daily")],
        custom_rules: vec![custom],
        delete_mode: DeleteMode::Permanent,
        dry_run: true,
        confirm_before_delete: false,
        min_size_mb: 50,
        min_age_days: 14,
        max_depth: 5,
        theme: "dark".into(),
        scan_on_launch: true,
        trash_retention_days: 90,
        recommendations_enabled: false,
        protect_git_tracked: false,
        detect_sensitive_files: false,
        default_cleanup_profile: "deep".into(),
        stale_scan_minutes: 45,
        require_rescan_before_cleanup: true,
        allow_danger_custom_rules: true,
        detect_active_usage: false,
        show_reclaim_estimate: false,
        show_network_recovery_cost: false,
        ..Settings::default()
    };
    s.rule_enabled.insert("node_modules".into(), false);
    s.schedule.enabled = true;
    s.schedule.every_days = 14;
    s
}

#[test]
fn a_1x_settings_file_keeps_every_value() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("settings.json");
    let old = customised();
    // A 1.x file has no show_advanced field.
    let mut json = serde_json::to_value(&old).unwrap();
    json.as_object_mut().unwrap().remove("show_advanced");
    std::fs::write(&file, serde_json::to_string_pretty(&json).unwrap()).unwrap();

    let loaded = Settings::load(&file);
    assert!(!loaded.show_advanced, "Advanced starts off after the upgrade");
    let mut back = serde_json::to_value(&loaded).unwrap();
    back.as_object_mut().unwrap().remove("show_advanced");
    assert_eq!(back, json, "every 1.x value survives loading");
    assert_eq!(loaded.scan_roots, old.scan_roots);
    assert_eq!(loaded.protected_paths, old.protected_paths);
    assert_eq!(loaded.custom_rules.len(), 1);
    assert_eq!(loaded.delete_mode, DeleteMode::Permanent);
    assert_eq!(loaded.trash_retention_days, 90);

    // Saving again and reloading changes nothing either.
    loaded.save(&file).unwrap();
    assert_eq!(serde_json::to_value(Settings::load(&file)).unwrap(), serde_json::to_value(&loaded).unwrap());
}

#[test]
fn the_advanced_switch_changes_nothing_that_can_be_deleted() {
    let off = customised();
    let on = Settings { show_advanced: true, ..off.clone() };
    assert_eq!(format!("{:?}", off.policy()), format!("{:?}", on.policy()));
    assert_eq!(serde_json::to_value(off.effective_rules()).unwrap(), serde_json::to_value(on.effective_rules()).unwrap());
    assert_eq!(off.hash(), on.hash(), "a scan made before the switch is still current after it");
    for p in ["/home/me/code/daily/app", "/home/me/code/other"] {
        assert_eq!(off.is_protected(p.as_ref()), on.is_protected(p.as_ref()));
    }
    assert_eq!(off.delete_mode, on.delete_mode);
    assert_eq!(off.dry_run, on.dry_run);
}

#[test]
fn restore_never_overwrites_a_folder_that_is_back() {
    let dir = tempfile::tempdir().unwrap();
    let back = dir.path().join("node_modules");
    std::fs::create_dir(&back).unwrap();
    let why = crate::trash_bin::restore_check(&back).unwrap_err();
    assert!(why.contains("not overwritten"), "{why}");
    let gone = dir.path().join("target");
    assert!(crate::trash_bin::restore_check(&gone).is_ok(), "a free spot can be restored to");
}

#[test]
fn the_reminder_fires_only_after_a_complete_scan_and_once_per_finding() {
    use crate::schedule::{reminder, Schedule, DEFAULT_MIN_BYTES};
    use std::collections::BTreeSet;
    const GB: u64 = 1024 * 1024 * 1024;
    let none = BTreeSet::new();
    let big = vec![("/a/node_modules".to_string(), 4 * GB), ("/b/target".to_string(), 2 * GB)];
    assert_eq!(Schedule::default().min_bytes, DEFAULT_MIN_BYTES);
    assert!(!Schedule::default().enabled, "still off by default");

    // A partial scan never reminds and forgets nothing.
    let (tell, keep) = reminder(false, &big, 5 * GB, &none);
    assert!(!tell && keep.is_empty());
    // Under the threshold: quiet.
    assert!(!reminder(true, &big[..1], 5 * GB, &none).0);
    // Over it: tell once, then stay quiet for the same finding.
    let (tell, seen) = reminder(true, &big, 5 * GB, &none);
    assert!(tell);
    assert!(!reminder(true, &big, 5 * GB, &seen).0, "the same finding is not repeated");
    // Something new on top: tell again.
    let mut more = big.clone();
    more.push(("/c/.gradle".to_string(), GB));
    assert!(reminder(true, &more, 5 * GB, &seen).0);
    // A folder that was cleaned is forgotten, so when it grows back it counts as new.
    let (_, after) = reminder(true, &big[1..], 5 * GB, &seen);
    assert_eq!(after.len(), 1);
    assert!(reminder(true, &big, 5 * GB, &after).0);
}

#[test]
fn a_1x_schedule_gets_the_default_threshold() {
    let s: crate::schedule::Schedule = serde_json::from_str(r#"{"enabled":true,"every_days":14,"profile":"safe","action":"remind"}"#).unwrap();
    assert!(s.enabled);
    assert_eq!(s.every_days, 14);
    assert_eq!(s.min_bytes, crate::schedule::DEFAULT_MIN_BYTES);
}
