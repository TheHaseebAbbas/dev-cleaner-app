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
