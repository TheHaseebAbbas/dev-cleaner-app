use dev_cleaner_core::{
    cleaner::{self, DeleteOutcome},
    global::{self, GlobalCache},
    history::{self, HistoryEntry},
    rules::Rule,
    scanner::{self, Item, ScanOptions},
    settings::Settings,
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
    cancel: Arc<AtomicBool>,
    scanning: Arc<AtomicBool>,
    globals: Mutex<Vec<GlobalCache>>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("settings.json"))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("history.jsonl"))
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
    };
    state.cancel.store(false, Ordering::SeqCst);
    state.items.lock().unwrap().clear();
    let cancel = state.cancel.clone();
    let scanning = state.scanning.clone();
    std::thread::spawn(move || {
        let emitter = app.clone();
        let items = scanner::scan(&opts, &cancel, |it| {
            let _ = emitter.emit("scan-item", it);
        });
        *app.state::<AppState>().items.lock().unwrap() = items;
        scanning.store(false, Ordering::SeqCst);
        let _ = app.emit("scan-done", cancel.load(Ordering::SeqCst));
    });
    Ok(())
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

fn refused(path: &str, why: &str, dry_run: bool) -> DeleteOutcome {
    DeleteOutcome { path: path.into(), ok: false, bytes_freed: 0, error: Some(why.into()), dry_run }
}

#[tauri::command]
fn get_items(state: State<'_, AppState>) -> Vec<Item> {
    state.items.lock().unwrap().clone()
}

/// Deletes only artifact folders (or their parts) that came out of the last scan and are not
/// protected. If a folder and one of its parts are both listed, only the folder is deleted.
#[tauri::command]
fn delete_items(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<DeleteOutcome>, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known: Vec<Item> = state.items.lock().unwrap().clone();
    let mut outcomes = vec![];
    for p in &paths {
        let owner = known.iter().find(|i| &i.path == p || i.parts.iter().any(|x| &x.path == p));
        let outcome = match owner {
            None => refused(p, "not part of the last scan", settings.dry_run),
            Some(i) if i.protected || settings.is_protected(std::path::Path::new(p)) => refused(p, "path is protected", settings.dry_run),
            Some(i) if &i.path != p && paths.contains(&i.path) => continue,
            Some(_) => cleaner::delete_one(std::path::Path::new(p), settings.delete_mode, settings.dry_run),
        };
        outcomes.push(outcome);
    }
    history::record(&history_path(&app)?, &outcomes, settings.delete_mode).map_err(|e| e.to_string())?;
    if !settings.dry_run {
        let gone: Vec<String> = outcomes.iter().filter(|o| o.ok).map(|o| o.path.clone()).collect();
        let mut items = state.items.lock().unwrap();
        items.retain(|i| !gone.contains(&i.path));
        for i in items.iter_mut() {
            let removed: Vec<_> = i.parts.iter().filter(|x| gone.contains(&x.path)).cloned().collect();
            if removed.is_empty() {
                continue;
            }
            i.parts.retain(|x| !gone.contains(&x.path));
            for r in &removed {
                i.disk_bytes = i.disk_bytes.saturating_sub(r.disk_bytes);
                i.apparent_bytes = i.apparent_bytes.saturating_sub(r.apparent_bytes);
                i.file_count = i.file_count.saturating_sub(r.file_count);
            }
            if i.parts.len() < 2 {
                i.parts.clear();
            }
        }
    }
    Ok(outcomes)
}

#[tauri::command]
async fn list_global_caches(state: State<'_, AppState>) -> Result<Vec<GlobalCache>, String> {
    let list = tauri::async_runtime::spawn_blocking(global::list_global_caches)
        .await
        .map_err(|e| e.to_string())?;
    *state.globals.lock().unwrap() = list.clone();
    Ok(list)
}

/// `ids` delete whole caches; `part_paths` delete single sub-folders of a known cache.
#[tauri::command]
fn delete_global_caches(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>, part_paths: Vec<String>) -> Result<Vec<DeleteOutcome>, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known = state.globals.lock().unwrap().clone();
    let mut outcomes: Vec<DeleteOutcome> = vec![];
    for id in &ids {
        outcomes.push(match known.iter().find(|c| &c.id == id && c.exists) {
            Some(c) if c.parts_only => refused(&c.path, "this folder can only be cleaned part by part", settings.dry_run),
            Some(c) => cleaner::delete_one(std::path::Path::new(&c.path), settings.delete_mode, settings.dry_run),
            None => refused(id, "unknown or missing cache", settings.dry_run),
        });
    }
    for p in &part_paths {
        let owner = known.iter().find(|c| c.parts.iter().any(|x| &x.path == p));
        outcomes.push(match owner {
            Some(c) if ids.contains(&c.id) => continue,
            Some(_) => cleaner::delete_one(std::path::Path::new(p), settings.delete_mode, settings.dry_run),
            None => refused(p, "not a known cache part", settings.dry_run),
        });
    }
    history::record(&history_path(&app)?, &outcomes, settings.delete_mode).map_err(|e| e.to_string())?;
    Ok(outcomes)
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

#[tauri::command]
fn disk_space() -> Option<(u64, u64)> {
    // (total, free) bytes of the volume holding the home directory, via `df`.
    let home = dev_cleaner_core_home()?;
    let out = std::process::Command::new("df").args(["-Pk"]).arg(home).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let cols: Vec<&str> = text.lines().nth(1)?.split_whitespace().collect();
    Some((cols.get(1)?.parse::<u64>().ok()? * 1024, cols.get(3)?.parse::<u64>().ok()? * 1024))
}

fn dev_cleaner_core_home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, list_rules, start_scan, cancel_scan, delete_items,
            get_items, get_locations, list_global_caches, delete_global_caches, get_history, reveal_path, disk_space
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Cleaner");
}
