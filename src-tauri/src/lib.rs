use dev_cleaner_core::{
    cleaner::{DeleteReport, OutcomeKind},
    global::{self, GlobalCache, GlobalContext},
    history::{self, HistoryEntry, Operation, ScanRecord},
    plan::{self, Preview},
    rules::Rule,
    scanner::{self, now_secs, new_scan_id, Item, ScanOptions, ScanSummary},
    settings::Settings,
    trash_bin::{self, TrashEntry, TrashOutcome},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    items: Mutex<Vec<Item>>,
    /// Summary of the last project scan; set when it finishes. Cleanup is allowed only against it.
    summary: Mutex<Option<ScanSummary>>,
    /// Summary of the last *complete* project scan, kept for SDK/toolchain references.
    last_complete: Mutex<Option<ScanSummary>>,
    cancel: Arc<AtomicBool>,
    scanning: Arc<AtomicBool>,
    globals: Mutex<Vec<GlobalCache>>,
    global_summary: Mutex<Option<ScanSummary>>,
    global_cancel: Arc<AtomicBool>,
    global_scanning: Arc<AtomicBool>,
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(name))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    data_file(app, "settings.json")
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    data_file(app, "history.jsonl")
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> {
    Ok(Settings::load(&settings_path(&app)?))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings.save(&settings_path(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_rules(app: AppHandle) -> Result<Vec<Rule>, String> {
    Ok(Settings::load(&settings_path(&app)?).effective_rules())
}

#[tauri::command]
fn start_scan(app: AppHandle, state: State<'_, AppState>, roots: Option<Vec<PathBuf>>) -> Result<(), String> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("a scan is already running".into());
    }
    let settings = Settings::load(&settings_path(&app)?);
    let opts = ScanOptions {
        roots: roots.unwrap_or_else(|| settings.scan_roots.clone()),
        rules: settings.effective_rules(),
        exclude_names: settings.exclude_names.clone(),
        protected_paths: settings.protected_paths.clone(),
        max_depth: settings.max_depth,
        policy: settings.policy(),
        settings_hash: settings.hash(),
    };
    state.cancel.store(false, Ordering::SeqCst);
    state.items.lock().unwrap().clear();
    // Until this scan finishes, nothing can be cleaned.
    *state.summary.lock().unwrap() = None;
    let cancel = state.cancel.clone();
    let scanning = state.scanning.clone();
    std::thread::spawn(move || {
        let emitter = app.clone();
        let progress = app.clone();
        let (items, summary) = scanner::scan_with_progress(
            &opts,
            &cancel,
            |it| {
                emitter.state::<AppState>().items.lock().unwrap().push(it.clone());
                let _ = emitter.emit("scan-item", it);
            },
            |p| {
                let _ = progress.emit("scan-progress", p);
            },
        );
        let total: u64 = items.iter().map(|i| i.disk_bytes).sum();
        let reclaim: u64 = items.iter().map(|i| i.reclaimable_bytes).sum();
        if let Ok(f) = data_file(&app, "scans.jsonl") {
            let _ = history::record_scan(&f, "projects", &summary, total, reclaim);
        }
        let st = app.state::<AppState>();
        *st.items.lock().unwrap() = items;
        *st.summary.lock().unwrap() = Some(summary.clone());
        if summary.complete {
            *st.last_complete.lock().unwrap() = Some(summary.clone());
        }
        scanning.store(false, Ordering::SeqCst);
        let _ = app.emit("scan-done", summary);
    });
    Ok(())
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn get_items(state: State<'_, AppState>) -> Vec<Item> {
    state.items.lock().unwrap().clone()
}

/// Revalidates a selection against the disk and the current settings, without deleting.
#[tauri::command]
fn preview_cleanup(app: AppHandle, state: State<'_, AppState>, scan_id: String, ids: Vec<String>) -> Result<Preview, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let items = state.items.lock().unwrap().clone();
    let summary = state.summary.lock().unwrap().clone();
    let planned = plan::resolve_items(&items, summary.as_ref(), &scan_id, &ids, true);
    Ok(plan::preview(&planned, summary.as_ref(), &settings.protected_paths))
}

fn log_report(app: &AppHandle, report: &DeleteReport) -> Result<(), String> {
    let mode = report.mode.unwrap_or(dev_cleaner_core::settings::DeleteMode::Trash);
    history::record(&history_path(app)?, &report.outcomes, mode).map_err(|e| e.to_string())?;
    history::record_operation(&data_file(app, "operations.jsonl")?, report).map_err(|e| e.to_string())
}

/// Deletes items (or parts) from the current, complete project scan by id. Every target is
/// checked again right before it is removed; `acknowledged` must be true for dangerous ones.
#[tauri::command]
fn delete_items(app: AppHandle, state: State<'_, AppState>, scan_id: String, ids: Vec<String>, acknowledged: bool) -> Result<DeleteReport, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let items = state.items.lock().unwrap().clone();
    let summary = state.summary.lock().unwrap().clone();
    let planned = plan::resolve_items(&items, summary.as_ref(), &scan_id, &ids, settings.dry_run);
    let report = plan::run(planned, settings.delete_mode, settings.dry_run, acknowledged, &settings.protected_paths);
    log_report(&app, &report)?;
    if !settings.dry_run {
        let gone: Vec<&str> = report.outcomes.iter().filter(|o| o.result == OutcomeKind::Removed).map(|o| o.id.as_str()).collect();
        let mut items = state.items.lock().unwrap();
        items.retain(|i| !gone.contains(&i.id.as_str()));
        for i in items.iter_mut() {
            let removed: Vec<_> = i.parts.iter().filter(|x| gone.contains(&x.id.as_str())).cloned().collect();
            if removed.is_empty() {
                continue;
            }
            i.parts.retain(|x| !gone.contains(&x.id.as_str()));
            for r in &removed {
                i.disk_bytes = i.disk_bytes.saturating_sub(r.disk_bytes);
                i.apparent_bytes = i.apparent_bytes.saturating_sub(r.apparent_bytes);
                i.reclaimable_bytes = i.reclaimable_bytes.saturating_sub(r.reclaimable_bytes);
                i.file_count = i.file_count.saturating_sub(r.file_count);
            }
            // Removing a part changes the folder itself; we did that, so it is not a foreign change.
            if let Some(fp) = dev_cleaner_core::safety::fingerprint(std::path::Path::new(&i.path)) {
                i.fingerprint = fp;
            }
            if i.parts.len() < 2 {
                i.parts.clear();
            }
        }
    }
    Ok(report)
}

#[tauri::command]
fn start_global_scan(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.global_scanning.swap(true, Ordering::SeqCst) {
        return Err("a scan is already running".into());
    }
    let settings = Settings::load(&settings_path(&app)?);
    let ctx = GlobalContext {
        scan_id: new_scan_id(),
        protected_paths: settings.protected_paths.clone(),
        refs: state.last_complete.lock().unwrap().as_ref().map(|s| s.refs.clone()),
        detect_sensitive_files: settings.detect_sensitive_files,
        min_confidence: Some(settings.minimum_recommendation_confidence),
    };
    state.global_cancel.store(false, Ordering::SeqCst);
    state.globals.lock().unwrap().clear();
    *state.global_summary.lock().unwrap() = None;
    let cancel = state.global_cancel.clone();
    let scanning = state.global_scanning.clone();
    std::thread::spawn(move || {
        let started_at = now_secs();
        let started = std::time::Instant::now();
        let (a, b) = (app.clone(), app.clone());
        let found = global::scan_global_caches(
            &global::Env::detect(),
            &ctx,
            &cancel,
            |c| {
                a.state::<AppState>().globals.lock().unwrap().push(c.clone());
                let _ = a.emit("global-item", c);
            },
            |p| {
                let _ = b.emit("global-progress", p);
            },
        );
        let cancelled = cancel.load(Ordering::SeqCst);
        let summary = ScanSummary {
            scan_id: ctx.scan_id.clone(),
            started_at,
            completed_at: now_secs(),
            complete: !cancelled,
            cancelled,
            found: found.len() as u64,
            elapsed_ms: started.elapsed().as_millis() as u64,
            measure_ms: started.elapsed().as_millis() as u64,
            bytes_examined: found.iter().map(|c| c.apparent_bytes).sum(),
            settings_hash: settings.hash(),
            rules_version: dev_cleaner_core::rules::RULES_VERSION,
            ..Default::default()
        };
        let total: u64 = found.iter().filter(|c| !c.info_only).map(|c| c.disk_bytes).sum();
        let reclaim: u64 = found.iter().filter(|c| !c.info_only).map(|c| c.reclaimable_bytes).sum();
        if let Ok(f) = data_file(&app, "scans.jsonl") {
            let _ = history::record_scan(&f, "global", &summary, total, reclaim);
        }
        let st = app.state::<AppState>();
        *st.globals.lock().unwrap() = found;
        *st.global_summary.lock().unwrap() = Some(summary.clone());
        scanning.store(false, Ordering::SeqCst);
        let _ = app.emit("global-done", summary);
    });
    Ok(())
}

#[tauri::command]
fn cancel_global_scan(state: State<'_, AppState>) {
    state.global_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn get_globals(state: State<'_, AppState>) -> Vec<GlobalCache> {
    state.globals.lock().unwrap().clone()
}

#[tauri::command]
fn preview_global_cleanup(app: AppHandle, state: State<'_, AppState>, scan_id: String, ids: Vec<String>, part_ids: Vec<String>) -> Result<Preview, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known = state.globals.lock().unwrap().clone();
    let summary = state.global_summary.lock().unwrap().clone();
    let planned = plan::resolve_globals(&known, summary.as_ref(), &scan_id, &ids, &part_ids, true);
    Ok(plan::preview(&planned, summary.as_ref(), &settings.protected_paths))
}

/// `ids` delete whole locations; `part_ids` delete single parts of a known location.
#[tauri::command]
fn delete_global_caches(app: AppHandle, state: State<'_, AppState>, scan_id: String, ids: Vec<String>, part_ids: Vec<String>, acknowledged: bool) -> Result<DeleteReport, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known = state.globals.lock().unwrap().clone();
    let summary = state.global_summary.lock().unwrap().clone();
    let planned = plan::resolve_globals(&known, summary.as_ref(), &scan_id, &ids, &part_ids, settings.dry_run);
    let report = plan::run(planned, settings.delete_mode, settings.dry_run, acknowledged, &settings.protected_paths);
    log_report(&app, &report)?;
    Ok(report)
}

#[derive(serde::Serialize)]
struct PathStatus {
    path: String,
    exists: bool,
}

#[derive(serde::Serialize)]
struct Locations {
    scan_roots: Vec<PathStatus>,
    exclude_names: Vec<String>,
    protected_paths: Vec<String>,
    max_depth: usize,
    android_sdk_env: Option<String>,
    global: Vec<global::Location>,
}

/// Everything Dev Cleaner looks at, for the "where it looks" dialog. Does not measure sizes.
#[tauri::command]
fn get_locations(app: AppHandle) -> Result<Locations, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let env = global::Env::detect();
    Ok(Locations {
        scan_roots: settings.scan_roots.iter().map(|p| PathStatus { path: p.to_string_lossy().into_owned(), exists: p.is_dir() }).collect(),
        exclude_names: settings.exclude_names,
        protected_paths: settings.protected_paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        max_depth: settings.max_depth,
        android_sdk_env: env.android_sdk_env.as_ref().map(|p| p.to_string_lossy().into_owned()),
        global: global::locations_with(&env),
    })
}

#[derive(serde::Serialize)]
struct Diagnostics {
    project_scan: Option<ScanSummary>,
    global_scan: Option<ScanSummary>,
    rules_total: usize,
    rules_enabled: usize,
    rules_disabled: Vec<String>,
    custom_rules: usize,
    rules_version: u32,
    scan_roots: Vec<String>,
    exclude_names: Vec<String>,
    protected_paths: Vec<String>,
    recent_scans: Vec<ScanRecord>,
    recent_operations: Vec<Operation>,
    data_folder: String,
}

/// Developer diagnostics: what the scanner did and why.
#[tauri::command]
fn get_diagnostics(app: AppHandle, state: State<'_, AppState>) -> Result<Diagnostics, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let rules = settings.effective_rules();
    Ok(Diagnostics {
        project_scan: state.summary.lock().unwrap().clone().or_else(|| state.last_complete.lock().unwrap().clone()),
        global_scan: state.global_summary.lock().unwrap().clone(),
        rules_total: rules.len(),
        rules_enabled: rules.iter().filter(|r| r.enabled).count(),
        rules_disabled: rules.iter().filter(|r| !r.enabled).map(|r| r.name.clone()).collect(),
        custom_rules: settings.custom_rules.len(),
        rules_version: dev_cleaner_core::rules::RULES_VERSION,
        scan_roots: settings.scan_roots.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        exclude_names: settings.exclude_names.clone(),
        protected_paths: settings.protected_paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        recent_scans: tail(history::load_lines(&data_file(&app, "scans.jsonl")?), 10),
        recent_operations: tail(history::load_lines(&data_file(&app, "operations.jsonl")?), 10),
        data_folder: app.path().app_config_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
    })
}

/// The last `n` entries, newest first.
fn tail<T>(mut v: Vec<T>, n: usize) -> Vec<T> {
    let k = v.len().saturating_sub(n);
    v.drain(..k);
    v.reverse();
    v
}

#[tauri::command]
fn get_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    Ok(history::load(&history_path(&app)?))
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("path does not exist".into());
    }
    let (cmd, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec!["-R", &path])
    } else if cfg!(target_os = "windows") {
        ("explorer", vec![&path])
    } else {
        ("xdg-open", vec![&path])
    };
    std::process::Command::new(cmd).args(args).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct TrashInfo {
    supported: bool,
    location: &'static str,
    retention_days: u32,
}

#[tauri::command]
fn trash_info(app: AppHandle) -> Result<TrashInfo, String> {
    let s = Settings::load(&settings_path(&app)?);
    Ok(TrashInfo { supported: trash_bin::supported(), location: trash_bin::location_hint(), retention_days: s.trash_retention_days })
}

#[tauri::command]
fn trash_list(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let s = Settings::load(&settings_path(&app)?);
    trash_bin::list(&history::load(&history_path(&app)?), s.trash_retention_days)
}

#[tauri::command]
fn trash_restore(app: AppHandle, ids: Vec<String>) -> Result<Vec<TrashOutcome>, String> {
    trash_bin::restore(&history::load(&history_path(&app)?), &ids)
}

#[tauri::command]
fn trash_purge(app: AppHandle, ids: Vec<String>) -> Result<Vec<TrashOutcome>, String> {
    trash_bin::purge(&history::load(&history_path(&app)?), &ids)
}

/// Remove items older than the retention period now.
#[tauri::command]
fn trash_clear_expired(app: AppHandle) -> Result<Vec<TrashOutcome>, String> {
    run_trash_expiry(&app)
}

fn run_trash_expiry(app: &AppHandle) -> Result<Vec<TrashOutcome>, String> {
    let s = Settings::load(&settings_path(app)?);
    let out = trash_bin::purge_expired(&history::load(&history_path(app)?), s.trash_retention_days, now_secs())?;
    if out.iter().any(|o| o.ok) {
        let _ = app.emit("trash-changed", ());
    }
    Ok(out)
}

#[tauri::command]
fn open_trash() -> Result<(), String> {
    let (cmd, args): (&str, Vec<String>) = if cfg!(target_os = "macos") {
        ("open", vec![home().map(|h| h.join(".Trash").to_string_lossy().into_owned()).unwrap_or_default()])
    } else if cfg!(target_os = "windows") {
        ("explorer", vec!["shell:RecycleBinFolder".into()])
    } else {
        ("xdg-open", vec!["trash:///".into()])
    };
    std::process::Command::new(cmd).args(args).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn disk_space() -> Option<(u64, u64)> {
    // (total, free) bytes of the volume that holds the home directory.
    let home = home()?;
    Some((fs2::total_space(&home).ok()?, fs2::available_space(&home).ok()?))
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Clear expired Trash items at start and then every hour while the app is open.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let _ = run_trash_expiry(&handle);
                std::thread::sleep(std::time::Duration::from_secs(3600));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, list_rules, start_scan, cancel_scan, preview_cleanup, delete_items,
            get_items, get_locations, start_global_scan, cancel_global_scan, get_globals, preview_global_cleanup, delete_global_caches,
            get_diagnostics, get_history, reveal_path, disk_space, trash_info, trash_list, trash_restore, trash_purge, trash_clear_expired, open_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Cleaner");
}
