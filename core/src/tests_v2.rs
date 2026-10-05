//! Tests for the v2 core logic: path safety, project identity, Git blocking, hard links,
//! sensitive files, fingerprints, recommendations, references and global locations.

use crate::cleaner::{self, ErrorCode, OutcomeKind, Target};
use crate::global::{list_global_caches_with, scan_global_caches, Env, GlobalContext};
use crate::model::*;
use crate::references::Refs;
use crate::rules::builtin_rules;
use crate::safety;
use crate::scanner::*;
use crate::settings::DeleteMode;
use std::{fs, path::Path, path::PathBuf, sync::atomic::AtomicBool, time::{Duration, SystemTime}};

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

fn scan_all(o: &ScanOptions) -> (Vec<Item>, ScanSummary) {
    scan_with_progress(o, &AtomicBool::new(false), |_| {}, |_| {})
}

fn age(p: &Path, days: u64) {
    let t = SystemTime::now() - Duration::from_secs(days * 86_400);
    for e in walkdir::WalkDir::new(p).contents_first(true) {
        let e = e.unwrap();
        if let Ok(f) = fs::File::open(e.path()) {
            let _ = f.set_modified(t);
        }
    }
}

fn git(dir: &Path, args: &[&str]) {
    let ok = std::process::Command::new("git").arg("-C").arg(dir).args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]).args(args).output().unwrap();
    assert!(ok.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ok.stderr));
}

#[test]
fn path_comparison_is_component_aware_and_normalised() {
    assert!(safety::is_within(Path::new("/p/App/node_modules"), Path::new("/p/App")));
    assert!(!safety::is_within(Path::new("/p/Application"), Path::new("/p/App")));
    assert!(safety::is_within(Path::new("/p/App/x/../y"), Path::new("/p/App/")));
    assert!(!safety::is_within(Path::new("/p/App/.."), Path::new("/p/App")));
    assert!(safety::same_path(Path::new("/p/App/"), Path::new("/p/./App")));
    if cfg!(any(windows, target_os = "macos")) {
        assert!(safety::is_within(Path::new("/P/APP/x"), Path::new("/p/app")));
    } else {
        assert!(!safety::is_within(Path::new("/P/APP/x"), Path::new("/p/app")));
    }
    let bases = vec![PathBuf::from("/p/App/node_modules/keep")];
    assert!(safety::contains_any(Path::new("/p/App/node_modules"), &bases).is_some());
    assert!(safety::contains_any(Path::new("/p/App/node_modules/keep"), &bases).is_none());
}

#[test]
fn system_and_personal_folders_are_refused() {
    let home = dirs::home_dir().unwrap();
    assert!(safety::system_block(&home).is_some());
    assert!(safety::system_block(&home.join("Documents")).is_some());
    assert!(safety::system_block(&home.join(".ssh/keys")).is_some());
    #[cfg(unix)]
    {
        assert!(safety::system_block(Path::new("/usr/lib/thing")).is_some());
        assert!(safety::system_block(Path::new("/var")).is_some());
        assert!(safety::system_block(Path::new("/")).is_some());
        assert!(safety::system_block(Path::new("/var/www/site/vendor")).is_none(), "projects under /var stay cleanable");
    }
    let t = tempfile::tempdir().unwrap();
    assert!(safety::system_block(&t.path().join("proj/node_modules")).is_none());
}

#[cfg(unix)]
#[test]
fn links_and_symlinked_targets_are_refused() {
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("real/node_modules/a"), 10);
    std::os::unix::fs::symlink(t.path().join("real/node_modules"), t.path().join("link")).unwrap();
    let e = cleaner::check_target(&t.path().join("link")).unwrap_err();
    assert_eq!(e.0, ErrorCode::TargetSymlink);
}

#[test]
fn project_root_follows_repository_and_project_chains() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    // Flutter app with an Android module: android/app/build belongs to my_app
    write(&r.join("my_app/pubspec.yaml"), 5);
    write(&r.join("my_app/android/settings.gradle"), 5);
    write(&r.join("my_app/android/app/build.gradle"), 5);
    write(&r.join("my_app/android/app/build/out.bin"), 100);
    write(&r.join("my_app/build/web/main.js"), 100);
    // Monorepo: a Git root with workspaces
    fs::create_dir_all(r.join("company/.git")).unwrap();
    write(&r.join("company/package.json"), 5);
    write(&r.join("company/apps/web/package.json"), 5);
    write(&r.join("company/apps/web/node_modules/a.js"), 50);
    let (items, _) = scan_all(&opts(r));
    let get = |p: &str| items.iter().find(|i| i.path.ends_with(p)).unwrap_or_else(|| panic!("{p} not found"));
    let android = get("android/app/build");
    assert_eq!(android.rule_id, "gradle-build");
    assert_eq!(android.project_name, "my_app");
    assert_eq!(Path::new(&android.package_path), Path::new("android/app"));
    assert_eq!(get("my_app/build").project_name, "my_app");
    let web = get("apps/web/node_modules");
    assert_eq!(web.project_name, "company");
    assert_eq!(Path::new(&web.package_path), Path::new("apps/web"));
}

#[test]
fn git_tracked_folders_are_blocked_unless_allowed() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path().join("repo");
    write(&r.join("go.mod"), 5);
    write(&r.join("vendor/modules.txt"), 5);
    write(&r.join("vendor/lib/a.go"), 5);
    git(&r, &["init", "-q"]);
    git(&r, &["add", "."]);
    git(&r, &["commit", "-qm", "init"]);
    let (items, _) = scan_all(&opts(t.path()));
    let v = items.iter().find(|i| i.rule_id == "go-vendor").unwrap();
    assert_eq!(v.git, GitStatus::Tracked);
    assert_eq!(v.block.as_ref().unwrap().source, BlockSource::Git);
    assert_eq!(v.recommendation.verdict, Verdict::Blocked);

    // A modified tracked file
    write(&r.join("vendor/lib/a.go"), 9);
    let mut o = opts(t.path());
    o.policy.protect_git_tracked = false;
    let (items, _) = scan_all(&o);
    let v = items.iter().find(|i| i.rule_id == "go-vendor").unwrap();
    assert_eq!(v.git, GitStatus::Modified);
    assert!(v.block.is_none());
    assert!(v.warnings.iter().any(|w| w.level == Level::Danger && w.message.contains("uncommitted")));
    assert_eq!(v.recommendation.verdict, Verdict::Keep);
}

#[test]
fn ignored_folders_gain_confidence() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path().join("web");
    write(&r.join("package.json"), 5);
    write(&r.join("pnpm-lock.yaml"), 5);
    write(&r.join(".gitignore"), 0);
    fs::write(r.join(".gitignore"), "node_modules\n").unwrap();
    write(&r.join("node_modules/a/index.js"), 5000);
    git(&r, &["init", "-q"]);
    let (items, _) = scan_all(&opts(t.path()));
    let nm = &items[0];
    assert_eq!(nm.git, GitStatus::Ignored);
    assert_eq!(nm.confidence, Confidence::VeryHigh);
    assert_eq!(nm.regenerates_with, "pnpm install");
    assert!(nm.detection.iter().any(|d| d.text.contains("pnpm")));
    assert!(nm.detection.iter().all(|d| d.ok));
}

#[cfg(unix)]
#[test]
fn hard_links_are_counted_once_and_shared_ones_are_not_reclaimable() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("store/pkg.js"), 64 * 1024);
    write(&r.join("app/package.json"), 5);
    fs::create_dir_all(r.join("app/node_modules/a")).unwrap();
    fs::hard_link(r.join("store/pkg.js"), r.join("app/node_modules/a/pkg.js")).unwrap();
    fs::hard_link(r.join("store/pkg.js"), r.join("app/node_modules/a/again.js")).unwrap();
    write(&r.join("app/node_modules/a/own.js"), 64 * 1024);
    let st = dir_stats(&r.join("app/node_modules"));
    assert_eq!(st.apparent_bytes, 3 * 64 * 1024, "apparent size counts every name");
    assert!(st.disk_bytes < st.apparent_bytes, "the linked file is counted once on disk");
    assert!(st.reclaimable_bytes < st.disk_bytes, "the store still holds the shared file");
    // When every link is inside, it is reclaimable.
    let whole = dir_stats(r);
    assert_eq!(whole.reclaimable_bytes, whole.disk_bytes);
}

#[test]
fn signing_keys_block_build_folders_but_package_fixtures_only_warn() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("app/pubspec.yaml"), 5);
    write(&r.join("app/build/app/upload-keystore.jks"), 50);
    write(&r.join("site/package.json"), 5);
    write(&r.join("site/node_modules/tls/test/server.pem"), 50);
    write(&r.join("site/.next/standalone/.env"), 50);
    write(&r.join("site/.next/standalone/.env.example"), 50);
    let (items, _) = scan_all(&opts(r));
    let get = |p: &str| items.iter().find(|i| i.path.ends_with(p)).unwrap();
    let build = get("app/build");
    assert_eq!(build.block.as_ref().unwrap().source, BlockSource::Sensitive);
    let nm = get("site/node_modules");
    assert!(nm.block.is_none());
    assert!(nm.warnings.iter().any(|w| w.level == Level::Caution && w.message.contains("server.pem")));
    let next = get("site/.next");
    assert!(next.block.is_none());
    assert_eq!(next.risk, Risk::Critical);
    assert!(next.warnings.iter().any(|w| w.level == Level::Danger && w.message.contains(".env")));
    assert!(!next.warnings.iter().any(|w| w.message.contains(".env.example")));
    // Detection can be turned off
    let mut o = opts(r);
    o.policy.detect_sensitive_files = false;
    let (items, _) = scan_all(&o);
    assert!(items.iter().all(|i| i.block.is_none()));
}

#[test]
fn split_and_redesigned_rules() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("game/ProjectSettings/x"), 5);
    write(&r.join("game/Library/a"), 50);
    write(&r.join("game/Temp/b"), 50);
    write(&r.join("ex/mix.exs"), 5);
    write(&r.join("ex/_build/dev/x"), 5);
    write(&r.join("ex/_build/test/x"), 5);
    write(&r.join("ex/deps/plug/x"), 5);
    write(&r.join("rb/Gemfile"), 5);
    write(&r.join("rb/.bundle/config"), 5);
    write(&r.join("rb/vendor/bundle/ruby/3.3.0/gems/x"), 5);
    write(&r.join("go/go.mod"), 5);
    write(&r.join("go/vendor/x.go"), 5); // no modules.txt: not a real vendor tree
    let (items, _) = scan_all(&opts(r));
    let rule = |p: &str| items.iter().find(|i| i.path.ends_with(p)).map(|i| i.rule_id.clone());
    assert_eq!(rule("game/Library").as_deref(), Some("unity-library"));
    assert_eq!(rule("game/Temp").as_deref(), Some("unity-temp"));
    assert_eq!(rule("ex/_build").as_deref(), Some("elixir-build"));
    assert_eq!(rule("ex/deps").as_deref(), Some("elixir-deps"));
    assert_eq!(rule("rb/.bundle"), None, ".bundle holds Bundler settings and is no longer offered");
    assert_eq!(rule("vendor/bundle").as_deref(), Some("ruby-vendor-bundle"));
    assert_eq!(rule("go/vendor"), None);
    let lib = items.iter().find(|i| i.rule_id == "unity-library").unwrap();
    let tmp = items.iter().find(|i| i.rule_id == "unity-temp").unwrap();
    assert_eq!(lib.rule_version, crate::rules::RULES_VERSION);
    assert!(lib.risk > tmp.risk);
    assert!(lib.rebuild_cost > tmp.rebuild_cost);
}

#[test]
fn fingerprint_detects_changes_since_the_scan() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("p/package.json"), 5);
    write(&r.join("p/node_modules/a.js"), 10);
    write(&r.join("q/package.json"), 5);
    write(&r.join("q/node_modules/a.js"), 10);
    let (items, _) = scan_all(&opts(r));
    let target = |i: &Item| Target { id: i.id.clone(), path: PathBuf::from(&i.path), fingerprint: Some(i.fingerprint.clone()), ..Default::default() };
    let p = items.iter().find(|i| i.path.ends_with("p/node_modules")).unwrap();
    let q = items.iter().find(|i| i.path.ends_with("q/node_modules")).unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    write(&r.join("p/node_modules/new-package/x.js"), 10);
    let out = cleaner::execute(&target(p), DeleteMode::Permanent, false, false, &[]);
    assert_eq!(out.code, Some(ErrorCode::TargetChanged));
    assert_eq!(out.result, OutcomeKind::Skipped);
    assert!(Path::new(&p.path).exists());
    let out = cleaner::execute(&target(q), DeleteMode::Permanent, false, false, &[]);
    assert!(out.ok, "{:?}", out.error);
    assert!(!Path::new(&q.path).exists());
    let again = cleaner::execute(&target(q), DeleteMode::Permanent, false, false, &[]);
    assert_eq!(again.code, Some(ErrorCode::TargetMissing));
}

#[test]
fn delete_gates_are_enforced_by_the_backend() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("proj/.venv");
    write(&d.join("pyvenv.cfg"), 10);
    let base = Target { id: "x".into(), path: d.clone(), ..Default::default() };
    // Needs acknowledgement
    let t1 = Target { needs_ack: true, ..base.clone() };
    assert_eq!(cleaner::execute(&t1, DeleteMode::Permanent, false, false, &[]).code, Some(ErrorCode::NeedsAcknowledgement));
    // ...but a dry run does not
    assert!(cleaner::execute(&t1, DeleteMode::Permanent, true, false, &[]).ok);
    // Blocked
    let t2 = Target { block: Some(Block::new(BlockSource::Git, "tracked")), ..base.clone() };
    assert_eq!(cleaner::execute(&t2, DeleteMode::Permanent, false, true, &[]).code, Some(ErrorCode::TargetBlocked));
    // Protected after the scan
    let out = cleaner::execute(&base, DeleteMode::Permanent, false, true, &[t.path().join("proj")]);
    assert_eq!(out.code, Some(ErrorCode::TargetProtected));
    assert_eq!(out.result, OutcomeKind::Blocked);
    assert!(d.exists());
    // Files are refused unless the target allows them
    let f = t.path().join("proj/file.bin");
    write(&f, 10);
    let tf = Target { path: f.clone(), ..base.clone() };
    assert_eq!(cleaner::execute(&tf, DeleteMode::Permanent, false, true, &[]).code, Some(ErrorCode::TargetNotDirectory));
    let tf = Target { allow_file: true, ..tf };
    assert!(cleaner::execute(&tf, DeleteMode::Permanent, false, true, &[]).ok);
    assert!(!f.exists());
}

#[test]
fn recommendations_are_conservative_and_explained() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("old/pubspec.yaml"), 5);
    write(&r.join("old/pubspec.lock"), 5);
    write(&r.join("old/build/app.bin"), 2 * 1024 * 1024);
    write(&r.join("old/lib/main.dart"), 5);
    age(&r.join("old"), 60);
    write(&r.join("new/package.json"), 5);
    write(&r.join("new/package-lock.json"), 5);
    write(&r.join("new/node_modules/a.js"), 2 * 1024 * 1024);
    let (items, _) = scan_all(&opts(r));
    let old = items.iter().find(|i| i.path.ends_with("old/build")).unwrap();
    assert_eq!(old.recommendation.verdict, Verdict::Recommended, "{:?}", old.recommendation);
    assert!(old.recommendation.reasons.iter().any(|x| x.ok && x.text.contains("Not changed")));
    let new = items.iter().find(|i| i.path.ends_with("new/node_modules")).unwrap();
    assert_eq!(new.recommendation.verdict, Verdict::Review);
    assert!(new.recommendation.reasons.iter().any(|x| !x.ok && x.text.contains("Project changed")));
    assert!(old.recommendation.score > new.recommendation.score);
    // Without Git and without a supporting lock file, confidence stays High; a Low one is reviewed.
    let f = crate::recommend::Facts {
        risk: Risk::Safe, category: Category::BuildArtifact, confidence: Confidence::Medium, min_confidence: Confidence::High, block: None,
        git: GitStatus::NotRepository, reclaimable: 1 << 30, idle_days: Some(100), project_idle_days: Some(100), rebuild_cost: Cost::Low,
        network_cost: Cost::None, download_bytes: 0, warnings: &[], usage: None,
    };
    assert_eq!(crate::recommend::recommend(&f).verdict, Verdict::Review);
}

#[test]
fn references_are_read_from_project_files() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("droid/settings.gradle"), 5);
    fs::write(r.join("droid/app/build.gradle.kts").tap_parent(), "android {\n    compileSdk = 34\n    buildToolsVersion = \"34.0.0\"\n    ndkVersion = \"26.1.10909125\"\n}\n").unwrap();
    fs::write(r.join("droid/gradle/wrapper/gradle-wrapper.properties").tap_parent(), "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip\n").unwrap();
    write(&r.join("flut/pubspec.yaml"), 5);
    fs::write(r.join("flut/.fvmrc"), "{\"flutter\": \"3.19.0\"}").unwrap();
    write(&r.join("flut/android/settings.gradle"), 5);
    fs::write(r.join("flut/android/app/build.gradle").tap_parent(), "android {\n  compileSdkVersion flutter.compileSdkVersion\n  ndkVersion flutter.ndkVersion\n}\n").unwrap();
    write(&r.join("rs/Cargo.toml"), 5);
    fs::write(r.join("rs/rust-toolchain.toml"), "[toolchain]\nchannel = \"1.80.0\"\n").unwrap();
    let (_, summary) = scan_all(&opts(r));
    let refs = &summary.refs;
    assert!(refs.android_platforms.get("34").is_some_and(|s| s.contains("droid")));
    assert!(refs.android_build_tools.contains_key("34.0.0"));
    assert!(refs.android_ndk.contains_key("26.1.10909125"));
    assert!(refs.android_platform_unpinned.contains("flut"));
    assert!(refs.gradle.contains_key("8.5"));
    assert!(refs.fvm.get("3.19.0").is_some_and(|s| s.contains("flut")));
    assert!(refs.rust.contains_key("1.80.0"));
    assert!(matches!(refs.usage_of("android-platforms", "android-34"), Some(Usage::Used { .. })));
    // A Flutter project hides its compile SDK, so other platforms are "unknown", not "unused".
    assert_eq!(refs.usage_of("android-platforms", "android-30"), Some(Usage::Unknown));
    assert!(matches!(refs.usage_of("rustup-toolchains", "1.80.0-x86_64-unknown-linux-gnu"), Some(Usage::Used { .. })));
    assert!(matches!(refs.usage_of("rustup-toolchains", "nightly-x86_64-unknown-linux-gnu"), Some(Usage::Unused { .. })));
    assert!(matches!(refs.usage_of("gradle-wrapper", "gradle-8.5-bin"), Some(Usage::Used { .. })));
    assert!(matches!(refs.usage_of("fvm-versions", "3.13.0"), Some(Usage::Unused { .. })));
}

trait TapParent {
    fn tap_parent(self) -> Self;
}
impl TapParent for PathBuf {
    fn tap_parent(self) -> Self {
        fs::create_dir_all(self.parent().unwrap()).unwrap();
        self
    }
}

fn env_linux(home: &Path) -> Env {
    Env { os: "linux".into(), home: Some(home.to_path_buf()), local_data: None, data: None, android_sdk_env: Some(home.join("sdk")) }
}

#[test]
fn global_parts_use_references_and_protection() {
    let t = tempfile::tempdir().unwrap();
    let h = t.path();
    write(&h.join("sdk/platforms/android-34/android.jar"), 100);
    write(&h.join("sdk/platforms/android-30/android.jar"), 100);
    write(&h.join(".gradle/caches/modules-2/x"), 100);
    let mut refs = Refs { projects: 2, ..Default::default() };
    refs.android_platforms.entry("34".into()).or_default().insert("app".into());
    let ctx = GlobalContext { scan_id: "s".into(), protected_paths: vec![h.join(".gradle/caches")], refs: Some(refs), detect_sensitive_files: true, min_confidence: None, detect_active_usage: false };
    let caches = scan_global_caches(&env_linux(h), &ctx, &AtomicBool::new(false), |_| {}, |_| {});
    let plat = caches.iter().find(|c| c.id == "android-platforms").unwrap();
    assert!(plat.parts_only && plat.references_checked);
    let p34 = plat.parts.iter().find(|p| p.name == "android-34").unwrap();
    let p30 = plat.parts.iter().find(|p| p.name == "android-30").unwrap();
    assert!(matches!(p34.usage, Some(Usage::Used { .. })));
    assert_eq!(p34.recommendation.as_ref().unwrap().verdict, Verdict::Keep);
    assert!(matches!(p30.usage, Some(Usage::Unused { .. })));
    assert_eq!(p30.risk, Some(Risk::Caution), "an unused SDK version is less risky");
    let gradle = caches.iter().find(|c| c.id == "gradle-caches").unwrap();
    assert_eq!(gradle.block.as_ref().unwrap().source, BlockSource::User, "protected paths apply to global cleanup");
    assert_eq!(gradle.risk, Risk::Blocked);
}

#[test]
fn device_data_archives_and_shared_folders_are_guarded() {
    let t = tempfile::tempdir().unwrap();
    let h = t.path();
    write(&h.join(".android/avd/Pixel.avd/userdata.img"), 100);
    write(&h.join(".android/avd/Pixel.ini"), 10);
    write(&h.join(".cache/Google/AndroidStudio2024.1/caches/x"), 100);
    write(&h.join(".cache/Google/Chrome/Default/Cache/x"), 100);
    let caches = list_global_caches_with(&env_linux(h));
    let avd = caches.iter().find(|c| c.id == "android-avd").unwrap();
    assert!(avd.parts_only);
    assert_eq!(avd.risk, Risk::Critical);
    assert_eq!(avd.category, Category::DeviceData);
    let part = &avd.parts[0];
    assert_eq!(crate::global::companions("android-avd", Path::new(&part.path)), vec![h.join(".android/avd/Pixel.ini")]);
    let studio = caches.iter().find(|c| c.id == "android-studio-linux").unwrap();
    assert!(studio.parts_only);
    assert_eq!(studio.parts.len(), 1, "Chrome's folder is never offered");
    assert_eq!(studio.parts[0].name, "AndroidStudio2024.1");
}

#[cfg(unix)]
#[test]
fn claude_active_version_is_blocked() {
    let t = tempfile::tempdir().unwrap();
    let h = t.path();
    write(&h.join(".local/share/claude/versions/1.0.1"), 100);
    write(&h.join(".local/share/claude/versions/1.0.2"), 100);
    fs::create_dir_all(h.join(".local/bin")).unwrap();
    std::os::unix::fs::symlink(h.join(".local/share/claude/versions/1.0.1"), h.join(".local/bin/claude")).unwrap();
    let c = list_global_caches_with(&env_linux(h)).into_iter().find(|c| c.id == "claude-versions").unwrap();
    assert!(c.parts_only);
    let active = c.parts.iter().find(|p| p.name == "1.0.1").unwrap();
    let old = c.parts.iter().find(|p| p.name == "1.0.2").unwrap();
    assert!(active.block.is_some() && active.is_file);
    assert!(old.block.is_none());
}

#[test]
fn windows_temp_only_offers_stale_items() {
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("Temp/old/f"), 10);
    write(&t.path().join("Temp/fresh/f"), 10);
    write(&t.path().join("Temp/loose.tmp"), 10);
    age(&t.path().join("Temp/old"), 30);
    let env = Env { os: "windows".into(), home: None, local_data: Some(t.path().to_path_buf()), data: None, android_sdk_env: None };
    let temp = list_global_caches_with(&env).into_iter().find(|c| c.id == "temp-win").unwrap();
    let get = |n: &str| temp.parts.iter().find(|p| p.name == n).unwrap();
    assert!(get("old").block.is_none());
    assert!(get("fresh").block.is_some());
    assert!(get("loose.tmp").is_file);
}

#[test]
fn custom_rules_cannot_claim_more_trust() {
    let mut r = builtin_rules().remove(0);
    r.risk = Risk::Critical;
    r.base_confidence = Confidence::VeryHigh;
    let s = crate::rules::sanitize_custom(r.clone(), false);
    assert_eq!(s.risk, Risk::Caution);
    assert_eq!(s.base_confidence, Confidence::Medium);
    assert!(s.custom);
    assert_eq!(crate::rules::sanitize_custom(r, true).risk, Risk::Danger);
    // Old settings files with low/medium/high still load.
    let old: Risk = serde_json::from_str("\"high\"").unwrap();
    assert_eq!(old, Risk::Danger);
}

#[test]
fn cancelled_scans_are_marked_incomplete() {
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("p/package.json"), 1);
    write(&t.path().join("p/node_modules/a"), 10);
    let (_, s) = scan_with_progress(&opts(t.path()), &AtomicBool::new(true), |_| {}, |_| {});
    assert!(s.cancelled && !s.complete);
    let (_, s) = scan_all(&opts(t.path()));
    assert!(s.complete && !s.scan_id.is_empty());
}

#[test]
fn history_reads_old_entries_and_report_counts() {
    let e: crate::history::HistoryEntry = serde_json::from_str(r#"{"timestamp":1,"path":"/x","bytes_freed":42,"mode":"trash"}"#).unwrap();
    assert_eq!(e.estimated_reclaimed, 42);
    assert_eq!(e.result, OutcomeKind::Removed);
    let t = Target { id: "a".into(), path: "/nope/a/b".into(), ..Default::default() };
    let outs = vec![
        cleaner::DeleteOutcome::refused(&t, ErrorCode::TargetChanged, "x", false),
        cleaner::DeleteOutcome::refused(&t, ErrorCode::TargetProtected, "x", false),
        cleaner::DeleteOutcome::refused(&t, ErrorCode::InUse, "x", false),
    ];
    let rep = cleaner::DeleteReport::new(outs, DeleteMode::Trash, false, None, None);
    assert_eq!((rep.removed, rep.skipped, rep.blocked, rep.failed), (0, 1, 1, 1));
}

#[test]
fn cleanup_requests_are_tied_to_one_complete_scan() {
    use crate::plan::{preview, resolve_items, run};
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("rs/Cargo.toml"), 5);
    write(&r.join("rs/target/debug/a"), 3000);
    write(&r.join("rs/target/release/b"), 1000);
    write(&r.join("web/package.json"), 5);
    write(&r.join("web/node_modules/a.js"), 100);
    let (items, summary) = scan_all(&opts(r));
    let target = items.iter().find(|i| i.rule_id == "rust-target").unwrap();
    let debug = target.parts.iter().find(|p| p.name == "debug").unwrap();
    let nm = items.iter().find(|i| i.rule_id == "node_modules").unwrap();

    // Wrong scan id: nothing resolves
    let res = resolve_items(&items, Some(&summary), "old-scan", &[nm.id.clone()], false);
    assert_eq!(res[0].as_ref().unwrap_err().code, Some(ErrorCode::ScanOutdated));
    // Incomplete scan: refused
    let mut partial = summary.clone();
    partial.complete = false;
    let res = resolve_items(&items, Some(&partial), &summary.scan_id, &[nm.id.clone()], false);
    assert_eq!(res[0].as_ref().unwrap_err().code, Some(ErrorCode::ScanIncomplete));
    // A part whose folder is also selected is folded into the folder; unknown ids are refused
    let ids = vec![target.id.clone(), debug.id.clone(), "nope".into()];
    let res = resolve_items(&items, Some(&summary), &summary.scan_id, &ids, false);
    assert_eq!(res.len(), 2);
    assert_eq!(res[1].as_ref().unwrap_err().code, Some(ErrorCode::TargetNotInScan));
    let pv = preview(&res, Some(&summary), &[]);
    assert_eq!((pv.selected, pv.ready, pv.changed), (2, 1, 1));
    assert_eq!(pv.projects, 1);
    // Running the part only removes the part
    let res = resolve_items(&items, Some(&summary), &summary.scan_id, &[debug.id.clone()], false);
    let rep = run(res, DeleteMode::Permanent, false, false, &[]);
    assert_eq!(rep.removed, 1, "{:?}", rep.outcomes);
    assert!(!r.join("rs/target/debug").exists() && r.join("rs/target/release").exists());
}
