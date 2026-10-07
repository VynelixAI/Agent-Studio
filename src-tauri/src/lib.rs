mod backend;
mod config;

use backend::{start_backend, stop_backend, wait_for_health, BackendState};
use config::{
    app_config_dir, default_workspace_path, ensure_starter_config, ensure_workspace_layout,
    load_config, resolve_config_path, resolve_workspace_path, save_config_mirrors, uri_for_mode,
    DesktopConfig, CONFIG_FILE_NAME,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    is_desktop: bool,
    workspace_path: String,
    config_path: String,
    app_config_dir: String,
    config: DesktopConfig,
    backend_api_url: String,
    backend_ready: bool,
    setup_needed: bool,
}

fn status_from(workspace: &std::path::Path, cfg_path: &std::path::Path, cfg: DesktopConfig, ready: bool) -> DesktopStatus {
    let need = !cfg.setup_complete;
    DesktopStatus {
        is_desktop: true,
        workspace_path: workspace.to_string_lossy().to_string(),
        config_path: cfg_path.to_string_lossy().to_string(),
        app_config_dir: app_config_dir().to_string_lossy().to_string(),
        backend_api_url: cfg.backend.api_url.clone(),
        backend_ready: ready,
        setup_needed: need,
        config: cfg,
    }
}

#[tauri::command]
fn get_default_workspace_path() -> String {
    default_workspace_path().to_string_lossy().to_string()
}

#[tauri::command]
fn get_app_config_dir() -> String {
    app_config_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_desktop_status(_app: AppHandle) -> Result<DesktopStatus, String> {
    let workspace = resolve_workspace_path(None);
    let cfg_path = ensure_starter_config(&workspace)?;
    let cfg = load_config(&cfg_path).unwrap_or_default();
    Ok(status_from(&workspace, &cfg_path, cfg, false))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupInput {
    workspace_path: Option<String>,
    /// local | atlas | iaas
    mongo_mode: Option<String>,
    database_name: String,
    database_uri: String,
    backend_port: Option<u16>,
    api_url: Option<String>,
    mongodb_default_database: Option<String>,
    connector_notes: Option<String>,
}

#[tauri::command]
async fn complete_desktop_setup(
    app: AppHandle,
    input: SetupInput,
) -> Result<DesktopStatus, String> {
    let workspace = resolve_workspace_path(input.workspace_path.as_deref());
    ensure_workspace_layout(&workspace)?;

    let port = input.backend_port.unwrap_or(8787);
    let api_url = input
        .api_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("http://127.0.0.1:{port}"));

    let mode = input
        .mongo_mode
        .unwrap_or_else(|| "local".into())
        .trim()
        .to_lowercase();
    let mode = match mode.as_str() {
        "atlas" | "iaas" | "local" => mode,
        _ => "local".into(),
    };

    let cfg_path = resolve_config_path(&workspace);
    let mut cfg = if cfg_path.exists() {
        load_config(&cfg_path).unwrap_or_default()
    } else {
        DesktopConfig::default()
    };

    cfg.workspace.path = workspace.to_string_lossy().to_string();
    cfg.database.mode = mode.clone();
    cfg.database.name = input.database_name.trim().to_string();
    if cfg.database.name.is_empty() {
        cfg.database.name = "vynelix_agent_studio".into();
    }
    cfg.database.uri = uri_for_mode(&mode, &input.database_uri);
    cfg.backend.port = port;
    cfg.backend.host = "127.0.0.1".into();
    cfg.backend.api_url = api_url.clone();
    cfg.connectors.mongodb_default_database = input
        .mongodb_default_database
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| cfg.database.name.clone());
    if let Some(n) = input.connector_notes {
        cfg.connectors.notes = n;
    } else {
        cfg.connectors.notes = format!(
            "Mongo mode={mode}. Edit this YAML (and copies under the workspace / Program Files) then restart."
        );
    }
    cfg.setup_complete = true;

    // Prefer writing to the platform app-config dir (always user-writable)
    let primary = {
        let app_cfg = app_config_dir().join(CONFIG_FILE_NAME);
        app_cfg
    };
    save_config_mirrors(&primary, &cfg, &workspace)?;

    let msg = start_backend(&app, &cfg, &primary)?;
    let ready = wait_for_health(&cfg.backend.host, cfg.backend.port, 30).await;
    if !ready {
        return Err(format!(
            "{msg} — API health check failed. Ensure MongoDB is reachable at the URI, then edit {}",
            primary.display()
        ));
    }

    Ok(status_from(&workspace, &primary, cfg, true))
}

#[tauri::command]
async fn restart_desktop_backend(app: AppHandle) -> Result<DesktopStatus, String> {
    let workspace = resolve_workspace_path(None);
    let cfg_path = resolve_config_path(&workspace);
    if !cfg_path.exists() {
        return Err("Config not found — complete first-run setup".into());
    }
    let cfg = load_config(&cfg_path)?;
    let _ = start_backend(&app, &cfg, &cfg_path)?;
    let ready = wait_for_health(&cfg.backend.host, cfg.backend.port, 30).await;
    Ok(status_from(&workspace, &cfg_path, cfg, ready))
}

#[tauri::command]
fn open_config_file() -> Result<String, String> {
    let workspace = resolve_workspace_path(None);
    let cfg_path = ensure_starter_config(&workspace)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&cfg_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &cfg_path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&cfg_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(cfg_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_config_folder() -> Result<String, String> {
    let dir = app_config_dir();
    fs_create(&dir)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().to_string())
}

fn fs_create(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            get_default_workspace_path,
            get_app_config_dir,
            get_desktop_status,
            complete_desktop_setup,
            restart_desktop_backend,
            open_config_file,
            open_config_folder,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let workspace = resolve_workspace_path(None);
                let _ = ensure_starter_config(&workspace);
                let cfg_path = resolve_config_path(&workspace);
                if cfg_path.exists() {
                    if let Ok(cfg) = load_config(&cfg_path) {
                        if cfg.setup_complete {
                            let _ = ensure_workspace_layout(&workspace);
                            if let Ok(msg) = start_backend(&handle, &cfg, &cfg_path) {
                                eprintln!("[agent-studio] {msg}");
                                let _ =
                                    wait_for_health(&cfg.backend.host, cfg.backend.port, 30).await;
                            }
                        } else {
                            eprintln!(
                                "[agent-studio] setup required — edit wizard will open. config={}",
                                cfg_path.display()
                            );
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Studio")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state: State<'_, BackendState> = app_handle.state();
                stop_backend(&state);
            }
        });
}
