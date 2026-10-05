use crate::{cleaner, rules::builtin_rules, scanner::*, settings::DeleteMode};
use std::{fs, sync::atomic::AtomicBool};

fn write(p: &std::path::Path, bytes: usize) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, vec![b'x'; bytes]).unwrap();
}

fn opts(root: &std::path::Path) -> ScanOptions {
    ScanOptions {
        roots: vec![root.to_path_buf()],
        rules: builtin_rules(),
        exclude_names: vec![".git".into()],
        protected_paths: vec![],
        max_depth: 8,
    }
}

#[test]
fn finds_artifacts_with_correct_sizes_and_skips_false_positives() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    // JS project
    write(&r.join("web/package.json"), 10);
    write(&r.join("web/node_modules/a/index.js"), 1000);
    write(&r.join("web/node_modules/a/node_modules/b/x.js"), 500); // nested, must not double count
    // Rust project
    write(&r.join("rs/Cargo.toml"), 10);
    write(&r.join("rs/target/debug/bin"), 2000);
    // Flutter project
    write(&r.join("app/pubspec.yaml"), 10);
    write(&r.join("app/build/out.bin"), 300);
    write(&r.join("app/.dart_tool/x"), 50);
    // false positives: no marker file
    write(&r.join("misc/node_modules/z.js"), 99);
    write(&r.join("misc/target/t"), 99);
    // venv requires pyvenv.cfg inside
    write(&r.join("py/.venv/pyvenv.cfg"), 20);
    write(&r.join("py2/venv/readme.txt"), 20);

    let items = scan(&opts(r), &AtomicBool::new(false), |_| {});
    let by = |s: &str| items.iter().find(|i| i.path.ends_with(s));
    assert_eq!(by("web/node_modules").unwrap().apparent_bytes, 1500);
    assert_eq!(by("web/node_modules").unwrap().file_count, 2);
    assert_eq!(by("rs/target").unwrap().rule_id, "rust-target");
    assert_eq!(by("app/build").unwrap().rule_id, "flutter-build");
    assert!(by("app/.dart_tool").is_some());
    assert!(by("py/.venv").is_some());
    assert!(by("misc/node_modules").is_none());
    assert!(by("misc/target").is_none());
    assert!(by("py2/venv").is_none());
    assert_eq!(items.len(), 5);
    // sorted largest first
    assert!(items.windows(2).all(|w| w[0].disk_bytes >= w[1].disk_bytes));
}

#[test]
fn protected_and_cancel() {
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("p/package.json"), 1);
    write(&t.path().join("p/node_modules/a"), 10);
    let mut o = opts(t.path());
    o.protected_paths = vec![t.path().join("p")];
    let items = scan(&o, &AtomicBool::new(false), |_| {});
    assert!(items[0].protected);
    let none = scan(&opts(t.path()), &AtomicBool::new(true), |_| {});
    assert!(none.is_empty());
}

#[test]
fn delete_dry_run_then_permanent() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("proj/node_modules");
    write(&d.join("a.js"), 4096);
    let dry = cleaner::delete_one(&d, DeleteMode::Permanent, true);
    assert!(dry.ok && dry.bytes_freed > 0 && d.exists());
    let real = cleaner::delete_one(&d, DeleteMode::Permanent, false);
    assert!(real.ok && !d.exists());
}

#[test]
fn delete_refuses_unsafe_targets() {
    assert!(cleaner::check_target(std::path::Path::new("/")).is_err());
    assert!(cleaner::check_target(std::path::Path::new("relative/x")).is_err());
    if let Some(h) = dirs::home_dir() {
        assert!(cleaner::check_target(&h).is_err());
    }
    let t = tempfile::tempdir().unwrap();
    let f = t.path().join("file.txt");
    write(&f, 1);
    assert!(cleaner::check_target(&f).is_err());
    #[cfg(unix)]
    {
        let link = t.path().join("link");
        std::os::unix::fs::symlink(t.path(), &link).unwrap();
        assert!(cleaner::check_target(&link).is_err());
    }
}

#[test]
fn split_rules_expose_independent_parts() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    write(&r.join("rs/Cargo.toml"), 10);
    write(&r.join("rs/target/debug/a"), 3000);
    write(&r.join("rs/target/release/b"), 1000);
    write(&r.join("rs/target/CACHEDIR.TAG"), 5);
    write(&r.join("web/package.json"), 10);
    write(&r.join("web/node_modules/a/x.js"), 100);
    write(&r.join("web/node_modules/b/y.js"), 100);

    let items = scan(&opts(r), &AtomicBool::new(false), |_| {});
    let target = items.iter().find(|i| i.rule_id == "rust-target").unwrap();
    assert_eq!(target.parts.len(), 2);
    assert_eq!(target.parts[0].name, "debug"); // largest first
    assert_eq!(target.parts[1].name, "release");
    assert!(target.parts.iter().all(|p| p.path.starts_with(&target.path)));
    assert!(target.description.contains("Cargo"));
    // node_modules is not split
    let nm = items.iter().find(|i| i.rule_id == "node_modules").unwrap();
    assert!(nm.parts.is_empty());

    // a part can be deleted on its own and the sibling survives
    let out = cleaner::delete_one(std::path::Path::new(&target.parts[0].path), DeleteMode::Permanent, false);
    assert!(out.ok);
    assert!(!r.join("rs/target/debug").exists());
    assert!(r.join("rs/target/release/b").exists());
}

#[test]
fn every_builtin_rule_has_a_description() {
    for r in builtin_rules() {
        assert!(!r.description.is_empty(), "{} has no description", r.id);
    }
}

#[test]
fn android_sdk_location_follows_env_var_then_os_default() {
    use crate::global::{list_global_caches_with, locations_with, Env};
    use std::path::PathBuf;
    let t = tempfile::tempdir().unwrap();
    let sdk = t.path().join("MySdk");
    write(&sdk.join("platforms/android-34/android.jar"), 100);
    write(&sdk.join("platforms/android-33/android.jar"), 50);
    write(&sdk.join("ndk/26.1/x"), 10);
    let mut env = Env {
        os: "windows".into(),
        home: Some(PathBuf::from("C:/Users/x")),
        local_data: Some(t.path().join("AppData/Local")),
        data: None,
        android_sdk_env: Some(sdk.clone()),
    };
    // env var wins
    assert_eq!(env.android_sdk_root().unwrap(), sdk);
    let caches = list_global_caches_with(&env);
    let plat = caches.iter().find(|c| c.id == "android-platforms").unwrap();
    assert!(plat.exists);
    assert_eq!(plat.parts.len(), 2);
    assert!(plat.parts.iter().any(|p| p.name == "android-34"));
    // env var unset: Windows default is under AppData\Local
    env.android_sdk_env = None;
    assert_eq!(env.android_sdk_root().unwrap(), t.path().join("AppData/Local/Android/Sdk"));
    // Windows-only entries show up, unix-only ones do not
    let ids: Vec<_> = locations_with(&env).into_iter().map(|l| l.id).collect();
    assert!(ids.contains(&"npm-win".to_string()) && ids.contains(&"jetbrains-win".to_string()));
    assert!(!ids.contains(&"npm".to_string()) && !ids.contains(&"deriveddata".to_string()));
    // macOS default
    env.os = "macos".into();
    env.home = Some(PathBuf::from("/Users/x"));
    assert_eq!(env.android_sdk_root().unwrap(), PathBuf::from("/Users/x/Library/Android/sdk"));
}

#[test]
fn windows_temp_is_parts_only() {
    use crate::global::{list_global_caches_with, Env};
    let t = tempfile::tempdir().unwrap();
    write(&t.path().join("Temp/a/f"), 10);
    write(&t.path().join("Temp/b/f"), 10);
    let env = Env { os: "windows".into(), home: None, local_data: Some(t.path().to_path_buf()), data: None, android_sdk_env: None };
    let temp = list_global_caches_with(&env).into_iter().find(|c| c.id == "temp-win").unwrap();
    assert!(temp.parts_only && temp.parts.len() == 2);
}

fn has(item_warnings: &[crate::scanner::Warning], level: crate::scanner::Level, needle: &str) -> bool {
    item_warnings.iter().any(|w| w.level == level && w.message.contains(needle))
}

#[test]
fn warns_about_tracked_recent_and_unrecreatable_folders() {
    use crate::scanner::Level::{Caution, Danger};
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    // a node_modules that git tracks
    write(&r.join("tracked/package.json"), 5);
    write(&r.join("tracked/node_modules/a.js"), 5);
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(r.join("tracked")).args(args).output().unwrap();
    git(&["init", "-q"]);
    git(&["add", "-f", "node_modules/a.js"]);
    // an untracked, not-ignored folder in another repo
    write(&r.join("loose/package.json"), 5);
    write(&r.join("loose/node_modules/a.js"), 5);
    std::process::Command::new("git").arg("-C").arg(r.join("loose")).args(["init", "-q"]).output().unwrap();
    // python venv without any requirements file
    write(&r.join("py/.venv/pyvenv.cfg"), 5);
    // python venv with requirements
    write(&r.join("py2/requirements.txt"), 5);
    write(&r.join("py2/.venv/pyvenv.cfg"), 5);

    let items = scan(&opts(r), &AtomicBool::new(false), |_| {});
    let get = |p: &str| items.iter().find(|i| i.path.ends_with(p)).unwrap();
    assert_eq!(get("tracked/node_modules").git_tracked, Some(true));
    assert!(has(&get("tracked/node_modules").warnings, Danger, "Git tracks"));
    assert!(has(&get("loose/node_modules").warnings, Caution, ".gitignore"));
    assert!(has(&get("py/.venv").warnings, Danger, "requirements"));
    assert!(!has(&get("py2/.venv").warnings, Danger, "requirements"));
    // freshly created files count as recent activity
    assert!(has(&get("py2/.venv").warnings, Caution, "changed"));
}

#[test]
fn vscode_only_offers_cache_folders_and_docker_is_view_only() {
    use crate::global::{list_global_caches_with, Env};
    let t = tempfile::tempdir().unwrap();
    let appdata = t.path().join("Roaming");
    write(&appdata.join("Code/Cache/x"), 100);
    write(&appdata.join("Code/logs/y"), 10);
    write(&appdata.join("Code/User/settings.json"), 10);
    write(&appdata.join("Code/Backups/unsaved"), 10);
    let local = t.path().join("Local");
    write(&local.join("Docker/wsl/disk/docker_data.vhdx"), 1000);
    write(&local.join("Packages/Canonical.Ubuntu_x/LocalState/ext4.vhdx"), 500);
    let env = Env { os: "windows".into(), home: None, local_data: Some(local), data: Some(appdata), android_sdk_env: None };
    let caches = list_global_caches_with(&env);
    let code = caches.iter().find(|c| c.id == "vscode-caches-win").unwrap();
    let names: Vec<_> = code.parts.iter().map(|p| p.name.as_str()).collect();
    assert!(names.contains(&"Cache") && names.contains(&"logs"));
    assert!(!names.contains(&"User") && !names.contains(&"Backups"));
    assert!(code.parts_only);
    let docker = caches.iter().find(|c| c.id == "docker-win").unwrap();
    assert!(docker.info_only && docker.exists);
    let wsl = caches.iter().find(|c| c.id == "wsl-distros-win").unwrap();
    assert!(wsl.info_only && wsl.parts.len() == 1 && wsl.parts[0].name.contains("Ubuntu"));
}

#[test]
fn rustup_default_toolchain_is_flagged() {
    use crate::global::{list_global_caches_with, Env};
    let t = tempfile::tempdir().unwrap();
    let home = t.path();
    write(&home.join(".rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc"), 10);
    write(&home.join(".rustup/toolchains/nightly-x86_64-unknown-linux-gnu/bin/rustc"), 10);
    write(&home.join(".rustup/settings.toml"), 0);
    std::fs::write(home.join(".rustup/settings.toml"), "version = \"12\"\ndefault_toolchain = \"stable-x86_64-unknown-linux-gnu\"\n").unwrap();
    let env = Env { os: "linux".into(), home: Some(home.to_path_buf()), local_data: None, data: None, android_sdk_env: None };
    let c = list_global_caches_with(&env).into_iter().find(|c| c.id == "rustup-toolchains").unwrap();
    let stable = c.parts.iter().find(|p| p.name.starts_with("stable")).unwrap();
    let nightly = c.parts.iter().find(|p| p.name.starts_with("nightly")).unwrap();
    assert!(stable.warning.is_some() && nightly.warning.is_none());
    assert!(!c.warnings.is_empty());
}

#[test]
fn trash_expiry_rules() {
    use crate::trash_bin::{expires_at, is_expired};
    assert_eq!(expires_at(1000, 0), None);
    assert_eq!(expires_at(1000, 1), Some(1000 + 86_400));
    assert!(!is_expired(1000, 0, u64::MAX));
    assert!(!is_expired(1000, 2, 1000 + 86_400));
    assert!(is_expired(1000, 2, 1000 + 2 * 86_400));
}

#[test]
fn trash_matches_only_history_entries() {
    use crate::{history::HistoryEntry, settings::DeleteMode, trash_bin::match_history};
    let h = vec![
        HistoryEntry { timestamp: 100, path: "C:\\p\\node_modules".into(), bytes_freed: 5, mode: DeleteMode::Trash },
        HistoryEntry { timestamp: 100, path: "/p/other".into(), bytes_freed: 5, mode: DeleteMode::Permanent },
    ];
    assert!(match_history(&h, "c:/p/node_modules/", 120).is_some());
    assert!(match_history(&h, "/p/other", 100).is_none(), "permanent deletes are not in the Trash");
    assert!(match_history(&h, "/p/unknown", 100).is_none());
    assert!(match_history(&h, "c:/p/node_modules", 100 + 3 * 86_400).is_none(), "too far apart in time");
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn trash_round_trip_restore_and_purge() {
    use crate::{cleaner::delete_one, history, settings::DeleteMode, trash_bin};
    let dir = tempfile::tempdir().unwrap();
    let hist_file = dir.path().join("h.jsonl");
    let mk = |name: &str| {
        let p = dir.path().join(name);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("f.txt"), vec![1u8; 4096]).unwrap();
        p
    };
    let (a, b) = (mk("proj-a-nm"), mk("proj-b-nm"));
    for p in [&a, &b] {
        let o = delete_one(p, DeleteMode::Trash, false);
        if !o.ok { eprintln!("skipping: no trash available here ({:?})", o.error); return; }
        history::record(&hist_file, &[o], DeleteMode::Trash).unwrap();
    }
    let h = history::load(&hist_file);
    let listed = trash_bin::list(&h, 30).unwrap();
    let ours: Vec<_> = listed.iter().filter(|e| e.name.starts_with("proj-")).collect();
    assert_eq!(ours.len(), 2);
    assert!(ours.iter().all(|e| e.expires_at.is_some()));

    let ida = ours.iter().find(|e| e.name == "proj-a-nm").unwrap().id.clone();
    let idb = ours.iter().find(|e| e.name == "proj-b-nm").unwrap().id.clone();
    let r = trash_bin::restore(&h, &[ida]).unwrap();
    assert!(r[0].ok, "{:?}", r[0].error);
    assert!(a.join("f.txt").exists());
    let r = trash_bin::purge(&h, &[idb]).unwrap();
    assert!(r[0].ok, "{:?}", r[0].error);
    assert!(!b.exists());
    assert!(trash_bin::list(&h, 30).unwrap().iter().all(|e| !e.name.starts_with("proj-")));
}
