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

/// Deletes only paths that came out of the last scan and are not protected.
#[tauri::command]
fn delete_items(app: AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<DeleteOutcome>, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known: Vec<Item> = state.items.lock().unwrap().clone();
    let mut outcomes = vec![];
    for p in &paths {
        let ok_item = known.iter().find(|i| &i.path == p);
        let outcome = match ok_item {
            None => DeleteOutcome { path: p.clone(), ok: false, bytes_freed: 0, error: Some("not part of the last scan".into()), dry_run: settings.dry_run },
            Some(i) if i.protected || settings.is_protected(std::path::Path::new(p)) => DeleteOutcome { path: p.clone(), ok: false, bytes_freed: 0, error: Some("path is protected".into()), dry_run: settings.dry_run },
            Some(_) => cleaner::delete_one(std::path::Path::new(p), settings.delete_mode, settings.dry_run),
        };
        outcomes.push(outcome);
    }
    history::record(&history_path(&app)?, &outcomes, settings.delete_mode).map_err(|e| e.to_string())?;
    if !settings.dry_run {
        let gone: Vec<&String> = outcomes.iter().filter(|o| o.ok).map(|o| &o.path).collect();
        state.items.lock().unwrap().retain(|i| !gone.contains(&&i.path));
    }
    Ok(outcomes)
}

#[tauri::command]
async fn list_global_caches() -> Vec<GlobalCache> {
    tauri::async_runtime::spawn_blocking(global::list_global_caches).await.unwrap_or_default()
}

#[tauri::command]
fn delete_global_caches(app: AppHandle, ids: Vec<String>) -> Result<Vec<DeleteOutcome>, String> {
    let settings = Settings::load(&settings_path(&app)?);
    let known = global::list_global_caches();
    let outcomes: Vec<DeleteOutcome> = ids
        .iter()
        .map(|id| match known.iter().find(|c| &c.id == id && c.exists) {
            Some(c) => cleaner::delete_one(std::path::Path::new(&c.path), settings.delete_mode, settings.dry_run),
            None => DeleteOutcome { path: id.clone(), ok: false, bytes_freed: 0, error: Some("unknown or missing cache".into()), dry_run: settings.dry_run },
        })
        .collect();
    history::record(&history_path(&app)?, &outcomes, settings.delete_mode).map_err(|e| e.to_string())?;
    Ok(outcomes)
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
            list_global_caches, delete_global_caches, get_history, reveal_path, disk_space
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Cleaner");
}
