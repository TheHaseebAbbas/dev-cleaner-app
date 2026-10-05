//! Tests for the advanced features: in-use detection, workspaces, part activity, scheduled
//! cleanup, Trash holds, rule tests, the dependency map and the "Over time" summary.

use crate::cleaner::{validate, ErrorCode, Target};
use crate::inuse::{ActiveUse, InUseStatus, Proc, Snapshot};
use crate::model::*;
use crate::rules::{builtin_rules, Rule};
use crate::scanner::*;
use crate::settings::Settings;
use crate::trash_bin::{due, expiry, Hold, Holds, TrashEntry};
use crate::workspace::{self, glob_match};
use std::{fs, path::Path, path::PathBuf, sync::atomic::AtomicBool};

fn write(p: &Path, bytes: usize) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, vec![b'x'; bytes]).unwrap();
}

fn opts(root: &Path) -> ScanOptions {
    ScanOptions {
        roots: vec![root.to_path_buf()],
        rules: builtin_rules(),
        exclude_names: vec![".git".into()],
        protected_paths: vec![],
        max_depth: 10,
        policy: Policy::default(),
        settings_hash: String::new(),
    }
}

fn proc_(pid: u32, name: &str, cwd: Option<&Path>, cmd: &str) -> Proc {
    Proc { pid, name: name.into(), exe: None, cwd: cwd.map(Path::to_path_buf), cmd: cmd.into() }
}

#[test]
fn snapshot_finds_processes_by_folder_and_tool() {
    let p = Path::new("/w/app/node_modules");
    let snap = Snapshot {
        procs: vec![
            proc_(10, "node", Some(Path::new("/w/app/node_modules/.bin")), "node x"),
            proc_(11, "bash", Some(Path::new("/w/app")), "bash"),
            proc_(12, "java", None, "java -cp gradle-launcher.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.7"),
            proc_(13, "qemu-system-x86_64", None, "emulator -avd Pixel_7"),
        ],
        open_files: vec![(11, PathBuf::from("/w/app/node_modules/x/lock"))],
    };
    let u = snap.check(p, "node_modules");
    assert_eq!(u.status, InUseStatus::InUse);
    assert_eq!(u.by.len(), 2, "{:?}", u.by);
    assert!(u.by.iter().any(|b| b.contains("working folder")) && u.by.iter().any(|b| b.contains("open file")));
    assert!(u.describe().starts_with("In use by"));
    assert_eq!(snap.check(Path::new("/w/other"), "x").status, InUseStatus::NotDetected);
    // Tool signals only apply to their own locations
    assert!(snap.check(Path::new("/h/.gradle/caches"), "gradle-caches").in_use());
    assert!(!snap.check(Path::new("/h/.npm"), "npm-cache").in_use());
    assert!(snap.check(Path::new("/h/.android/avd/Pixel_7.avd"), "android-avd").in_use());
    assert!(!snap.check(Path::new("/h/.android/avd/Other.avd"), "android-avd").in_use());
    assert_eq!(snap.working_in(Path::new("/w/app")).len(), 2);
    // Locks make it in use; no lock information changes nothing
    let lk = crate::inuse::with_locks(ActiveUse { status: InUseStatus::NotDetected, by: vec![], locked_files: 0, locked_bytes: 0 }, Some((2, 10)));
    assert!(lk.in_use() && lk.describe().contains("2 files are locked"));
    assert_eq!(crate::inuse::with_locks(ActiveUse::unknown(), None).status, InUseStatus::Unknown);
}

#[cfg(target_os = "linux")]
#[test]
fn a_running_process_marks_its_folder_in_use_during_a_scan() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("web/package.json"), 5);
    write(&r.join("web/node_modules/a.js"), 100);
    write(&r.join("idle/package.json"), 5);
    write(&r.join("idle/node_modules/a.js"), 100);
    let mut child = std::process::Command::new("sleep").arg("30").current_dir(r.join("web/node_modules")).spawn().unwrap();
    let mut o = opts(r);
    o.policy.detect_active_usage = true;
    let (items, _) = scan_with_progress(&o, &AtomicBool::new(false), |_| {}, |_| {});
    let _ = child.kill();
    let web = items.iter().find(|i| i.project_name == "web").unwrap();
    let idle = items.iter().find(|i| i.project_name == "idle").unwrap();
    assert!(web.in_use.as_ref().unwrap().in_use(), "{:?}", web.in_use);
    assert!(web.warnings.iter().any(|w| w.level == Level::Danger && w.message.contains("sleep")));
    assert_ne!(web.recommendation.verdict, Verdict::Recommended);
    assert_eq!(idle.in_use.as_ref().unwrap().status, InUseStatus::NotDetected);
    // Off: nothing is reported at all
    let (items, _) = scan_with_progress(&opts(r), &AtomicBool::new(false), |_| {}, |_| {});
    assert!(items.iter().all(|i| i.in_use.is_none()));
}

#[test]
fn cleanup_refuses_in_use_targets_and_first_use_rules_without_confirmation() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("a/b/build");
    write(&d.join("x"), 10);
    let mut tg = Target { id: "1".into(), path: d.clone(), in_use: Some("In use by node (pid 1)".into()), ..Default::default() };
    assert_eq!(validate(&tg, false, &[]).unwrap_err().0, ErrorCode::InUse);
    assert!(validate(&tg, true, &[]).is_ok());
    tg.in_use = None;
    tg.first_use_rule = true;
    tg.rule_id = "my-rule".into();
    let e = validate(&tg, false, &[]).unwrap_err();
    assert_eq!(e.0, ErrorCode::NeedsAcknowledgement);
    assert!(e.1.contains("my-rule"));
    assert!(validate(&tg, true, &[]).is_ok());
}

#[test]
fn custom_rules_need_confirmation_until_used() {
    let mut s = Settings::default();
    let mut r = builtin_rules()[0].clone();
    r.id = "mine".into();
    r.custom = true;
    r.confirmed = false;
    s.custom_rules.push(r.clone());
    assert_eq!(s.unconfirmed_custom_rules(), vec!["mine".to_string()]);
    s.custom_rules[0].confirmed = true;
    assert!(s.unconfirmed_custom_rules().is_empty());
    assert!(builtin_rules().iter().all(|r| r.confirmed));
    // Old settings files without the field load as unconfirmed
    let mut v = serde_json::to_value(&r).unwrap();
    v.as_object_mut().unwrap().remove("confirmed");
    assert!(!serde_json::from_value::<Rule>(v).unwrap().confirmed);
}

#[test]
fn workspace_patterns_and_declarations() {
    assert!(glob_match("packages/*", "packages/ui"));
    assert!(!glob_match("packages/*", "packages/ui/src"));
    assert!(glob_match("apps/**", "apps/web/inner"));
    assert!(glob_match("./crates/*-core/", "crates/dev-core"));
    assert!(!glob_match("!packages/private", "packages/private"));
    assert!(glob_match("app", "app"));

    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    fs::write(r.join("pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n  - \"packages/**\"\n# x\n").unwrap();
    assert_eq!(workspace::declared(r).unwrap(), ("pnpm".to_string(), vec!["apps/*".to_string(), "packages/**".to_string()]));
    let c = r.join("c");
    write(&c.join("Cargo.toml"), 0);
    fs::write(c.join("Cargo.toml"), "[workspace]\nmembers = [\n  \"core\",\n  \"src-tauri\",\n]\n\n[profile.release]\n").unwrap();
    assert_eq!(workspace::declared(&c).unwrap().1, vec!["core", "src-tauri"]);
    let g = r.join("g");
    write(&g.join("settings.gradle.kts"), 0);
    fs::write(g.join("settings.gradle.kts"), "rootProject.name = \"x\"\ninclude(\":app\", \":feature:login\")\nincludeBuild(\"plugins\")\n").unwrap();
    assert_eq!(workspace::declared(&g).unwrap().1, vec!["app", "feature/login"]);
    let go = r.join("go");
    write(&go.join("go.work"), 0);
    fs::write(go.join("go.work"), "go 1.22\nuse (\n  ./api\n  ./tools // x\n)\nuse ./cli\n").unwrap();
    assert_eq!(workspace::declared(&go).unwrap().1, vec!["api", "tools", "cli"]);
    let y = r.join("y");
    write(&y.join("yarn.lock"), 0);
    fs::write(y.join("package.json"), r#"{"workspaces":{"packages":["libs/*"]}}"#).unwrap();
    assert_eq!(workspace::declared(&y).unwrap().0, "yarn");
    assert!(workspace::declared(&r.join("nothing")).is_none());
}

#[test]
fn monorepo_members_belong_to_the_workspace() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path().join("mono");
    write(&r.join("package.json"), 0);
    fs::write(r.join("package.json"), r#"{"name":"mono","workspaces":["apps/*"]}"#).unwrap();
    write(&r.join("apps/web/package.json"), 5);
    write(&r.join("apps/web/node_modules/a.js"), 100);
    write(&r.join("node_modules/b.js"), 100);
    // A folder that is not a declared member stays its own project
    write(&r.join("scratch/demo/package.json"), 5);
    write(&r.join("scratch/demo/node_modules/c.js"), 100);
    let ws = workspace::find(&r.join("apps/web"), t.path()).unwrap();
    assert_eq!((ws.kind.as_str(), ws.member.as_str()), ("npm", "apps/web"));
    assert!(workspace::find(&r.join("scratch/demo"), t.path()).is_none());
    let (items, _) = scan_with_progress(&opts(t.path()), &AtomicBool::new(false), |_| {}, |_| {});
    let web = items.iter().find(|i| i.path.ends_with("web/node_modules")).unwrap();
    let root = items.iter().find(|i| i.path == r.join("node_modules").to_string_lossy()).unwrap();
    let demo = items.iter().find(|i| i.path.contains("demo")).unwrap();
    assert_eq!(web.project_name, "mono");
    assert_eq!(web.workspace.as_ref().unwrap().member, "apps/web");
    assert_eq!(root.project_name, "mono");
    assert_eq!(demo.project_name, "demo");
}

#[test]
fn split_parts_report_activity() {
    let now = 10_000_000;
    assert_eq!(part_activity(now - 3600, now, false), PartActivity::Active);
    assert_eq!(part_activity(now - 3 * 86_400, now, false), PartActivity::Recent);
    assert_eq!(part_activity(now - 30 * 86_400, now, false), PartActivity::Old);
    assert_eq!(part_activity(now - 30 * 86_400, now, true), PartActivity::Active);
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("rs/Cargo.toml"), 5);
    write(&r.join("rs/target/debug/a"), 3000);
    write(&r.join("rs/target/release/b"), 1000);
    let (items, _) = scan_with_progress(&opts(r), &AtomicBool::new(false), |_| {}, |_| {});
    let tg = items.iter().find(|i| i.rule_id == "rust-target").unwrap();
    assert!(tg.parts.iter().all(|p| p.activity == Some(PartActivity::Active) && p.recommendation.is_some()));
}

fn item(risk: Risk, verdict: Verdict) -> Item {
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("p/package.json"), 5);
    write(&t.path().join("p/node_modules/a"), 5);
    let (mut items, _) = scan_with_progress(&opts(t.path()), &AtomicBool::new(false), |_| {}, |_| {});
    let mut i = items.remove(0);
    i.risk = risk;
    i.recommendation.verdict = verdict;
    i.warnings.clear();
    i.block = None;
    i
}

#[test]
fn scheduled_runs_only_take_the_safest_items() {
    use crate::schedule::{eligible, is_due, next_run, Schedule};
    let s = Schedule { enabled: true, every_days: 7, ..Default::default() };
    assert!(!Schedule::default().enabled);
    assert_eq!(next_run(&s, 100), Some(100 + 7 * 86_400));
    assert!(!is_due(&s, 100, 100 + 86_400) && is_due(&s, 100, 100 + 7 * 86_400));
    assert!(!is_due(&Schedule::default(), 0, u64::MAX));
    let ok = item(Risk::Safe, Verdict::Recommended);
    assert!(eligible(&ok, "safe"));
    assert!(!eligible(&item(Risk::Caution, Verdict::Recommended), "safe"));
    assert!(eligible(&item(Risk::Caution, Verdict::Recommended), "recommended"));
    assert!(!eligible(&item(Risk::Danger, Verdict::Recommended), "recommended"));
    assert!(!eligible(&item(Risk::Safe, Verdict::Review), "recommended"));
    let mut w = ok.clone();
    w.warnings.push(Warning { level: Level::Caution, message: "x".into() });
    assert!(!eligible(&w, "recommended"));
    let mut u = ok.clone();
    u.in_use = Some(ActiveUse { status: InUseStatus::InUse, by: vec!["x".into()], locked_files: 0, locked_bytes: 0 });
    assert!(!eligible(&u, "recommended"));
}

fn entry(id: &str, path: &str, deleted_at: u64, retention: u32, holds: &Holds) -> TrashEntry {
    let hold = holds.get(path, deleted_at);
    TrashEntry { id: id.into(), name: id.into(), original_path: path.into(), deleted_at, bytes: 1, expires_at: expiry(deleted_at, retention, hold), hold }
}

#[test]
fn trash_holds_override_the_retention_period() {
    let day = 86_400;
    assert_eq!(expiry(0, 30, None), Some(30 * day));
    assert_eq!(expiry(0, 0, None), None);
    assert_eq!(expiry(0, 30, Some(Hold::Forever)), None);
    assert_eq!(expiry(0, 0, Some(Hold::Until(5))), Some(5));
    let mut holds = Holds::default();
    let list = vec![entry("a", "/p/A", 0, 30, &holds), entry("b", "/p/b", 0, 30, &holds)];
    holds.set(&list, &["a".into()], Some(Hold::Forever));
    // Keys ignore case and slashes direction, and survive a new Trash id
    assert_eq!(holds.get("\\p\\a", 0), Some(Hold::Forever));
    let list = vec![entry("a2", "/p/A", 0, 30, &holds), entry("b", "/p/b", 0, 30, &holds)];
    assert_eq!(due(&list, 31 * day), vec!["b".to_string()]);
    // Clearing restores the default; holds of items no longer in the Trash are forgotten
    holds.set(&list, &["a2".into()], None);
    assert!(holds.0.is_empty());
    holds.set(&list, &["b".into()], Some(Hold::Until(90 * day)));
    holds.set(&list[..1], &[], None);
    assert!(holds.0.is_empty());
    let j = serde_json::to_string(&Hold::Until(7)).unwrap();
    assert_eq!(j, r#"{"kind":"until","until":7}"#);
    assert_eq!(serde_json::to_string(&Hold::Forever).unwrap(), r#"{"kind":"forever"}"#);
}

#[test]
fn rule_test_reports_matches_and_folders_other_rules_claim() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("a/.marker"), 1);
    write(&r.join("a/out/x"), 500);
    write(&r.join("b/.marker"), 1);
    write(&r.join("b/out/y"), 300);
    write(&r.join("c/package.json"), 1);
    write(&r.join("c/node_modules/pkg/.marker"), 1);
    write(&r.join("c/node_modules/pkg/out/z"), 50);
    let mut s = Settings { scan_roots: vec![r.to_path_buf()], ..Default::default() };
    s.exclude_names = vec![];
    let mut rule = builtin_rules()[0].clone();
    rule.id = "my-out".into();
    rule.name = "My out".into();
    rule.dir_names = vec!["out".into()];
    rule.parent_markers = vec![".marker".into()];
    rule.self_markers = vec![];
    rule.risk = Risk::Critical;
    let res = crate::ruletest::test_rule(rule, &s, &AtomicBool::new(false));
    assert_eq!(res.matches, 3, "{:?}", res.samples);
    assert_eq!(res.effective, 2);
    assert!(res.total_bytes >= 800);
    let claimed = res.samples.iter().find(|m| m.path.contains("node_modules")).unwrap();
    assert!(claimed.claimed_by.is_some());
    assert!(res.samples.last().unwrap().claimed_by.is_some(), "claimed matches sort last");
}

#[test]
fn dependency_map_links_projects_and_versions() {
    use crate::global::{scan_global_caches, Env, GlobalContext};
    use crate::references::Refs;
    let t = tempfile::tempdir().unwrap();
    let h = t.path();
    write(&h.join("sdk/platforms/android-34/android.jar"), 100);
    write(&h.join("sdk/platforms/android-30/android.jar"), 100);
    let mut refs = Refs { projects: 2, ..Default::default() };
    refs.android_platforms.entry("34".into()).or_default().insert("app".into());
    refs.android_platforms.entry("35".into()).or_default().insert("new-app".into());
    let env = Env { os: "linux".into(), home: Some(h.to_path_buf()), local_data: None, data: None, android_sdk_env: Some(h.join("sdk")) };
    let caches = scan_global_caches(&env, &GlobalContext { scan_id: "s".into(), refs: Some(refs.clone()), ..Default::default() }, &AtomicBool::new(false), |_| {}, |_| {});
    let g = crate::graph::build(Some(&refs), &caches);
    assert!(g.has_projects && g.has_globals);
    let plat = g.groups.iter().find(|x| x.id == "android-platforms").unwrap();
    let v34 = plat.versions.iter().find(|v| v.label == "android-34").unwrap();
    let v30 = plat.versions.iter().find(|v| v.label == "android-30").unwrap();
    let v35 = plat.versions.iter().find(|v| v.label == "android-35").unwrap();
    assert_eq!(v34.projects, vec!["app"]);
    assert!(v30.projects.is_empty() && v30.installed);
    assert!(!v35.installed && v35.projects == vec!["new-app"]);
    assert_eq!(g.projects, vec!["app", "new-app"]);
    assert!(g.unused_bytes >= 100);
    // Without a project scan nothing is called unused
    assert_eq!(crate::graph::build(None, &caches).unused_bytes, 0);
}

#[test]
fn over_time_summary() {
    use crate::analytics::{compute, year_month};
    use crate::history::{HistoryEntry, ScanRecord};
    use crate::settings::DeleteMode;
    assert_eq!(year_month(0), (1970, 1));
    assert_eq!(year_month(1_790_000_000), (2026, 9)); // 2026-09-21
    assert_eq!(year_month(951_782_400), (2000, 2)); // 2000-02-29
    let h = |ts: u64, rule: &str, bytes: u64| HistoryEntry {
        id: String::new(), timestamp: ts, scan_id: String::new(), item_id: String::new(), path: "/x".into(), project_root: String::new(),
        rule_id: rule.into(), rule_version: 2, category: Some(Category::BuildArtifact), risk: None, size_before: bytes, estimated_reclaimed: bytes,
        mode: DeleteMode::Trash, result: crate::cleaner::OutcomeKind::Removed,
    };
    let now = 1_790_000_000;
    let hist = vec![h(now - 86_400, "node_modules", 100), h(now - 40 * 86_400, "rust-target", 50), h(now - 900 * 86_400, "old", 7)];
    let scans = vec![ScanRecord { scan_id: "a".into(), kind: "projects".into(), timestamp: 5, item_count: 3, total_bytes: 9, reclaimable_bytes: 9, duration_ms: 1, complete: true },
                     ScanRecord { scan_id: "b".into(), kind: "global".into(), timestamp: 6, item_count: 3, total_bytes: 9, reclaimable_bytes: 9, duration_ms: 1, complete: true }];
    let a = compute(&hist, &scans, now, 12);
    assert_eq!(a.months.len(), 12);
    assert_eq!(a.months.last().unwrap().month, "2026-09");
    assert_eq!(a.months.last().unwrap().bytes, 100);
    assert_eq!(a.months.iter().map(|m| m.bytes).sum::<u64>(), 150);
    assert_eq!(a.by_rule[0].key, "node_modules");
    assert_eq!(a.by_category[0].key, "build_artifact");
    assert_eq!(a.scans.len(), 1);
}
