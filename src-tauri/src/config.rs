//! Desktop workspace + editable YAML config for packaged Agent Studio installs.
//!
//! Config resolution (first match wins):
//! 1. `$AGENT_STUDIO_CONFIG` (if set by the shell)
//! 2. Pointer file `~/.vynelixai/agent-studio-config.txt`
//! 3. Windows: `%ProgramFiles%\AgentStudio\agent-studio.yaml` (when present)
//! 4. Platform app-data config dir (always writable)
//! 5. `<workspace>/agent-studio.yaml`
//!
//! Workspace data (runs/plugins) defaults to `~/AgentStudio` on all OSes.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = "agent-studio.yaml";
pub const DEFAULT_WORKSPACE_DIRNAME: &str = "AgentStudio";
pub const APP_DIRNAME: &str = "AgentStudio";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceCfg {
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendCfg {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_api_url")]
    pub api_url: String,
}

fn default_host() -> String {
    "127.0.0.1".into()
}
fn default_port() -> u16 {
    8787
}
fn default_api_url() -> String {
    "http://127.0.0.1:8787".into()
}

/// `local` | `atlas` | `iaas`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseCfg {
    #[serde(default = "default_mongo_mode")]
    pub mode: String,
    #[serde(default = "default_db_name")]
    pub name: String,
    #[serde(default = "default_db_uri")]
    pub uri: String,
}

fn default_mongo_mode() -> String {
    "local".into()
}
fn default_db_name() -> String {
    "vynelix_agent_studio".into()
}
fn default_db_uri() -> String {
    "mongodb://127.0.0.1:27017".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorsCfg {
    #[serde(default = "default_db_name")]
    pub mongodb_default_database: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopConfig {
    #[serde(default)]
    pub workspace: WorkspaceCfg,
    #[serde(default)]
    pub backend: BackendCfg,
    #[serde(default)]
    pub database: DatabaseCfg,
    #[serde(default)]
    pub connectors: ConnectorsCfg,
    #[serde(default)]
    pub setup_complete: bool,
}

impl Default for WorkspaceCfg {
    fn default() -> Self {
        Self { path: String::new() }
    }
}
impl Default for BackendCfg {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            api_url: default_api_url(),
        }
    }
}
impl Default for DatabaseCfg {
    fn default() -> Self {
        Self {
            mode: default_mongo_mode(),
            name: default_db_name(),
            uri: default_db_uri(),
        }
    }
}
impl Default for ConnectorsCfg {
    fn default() -> Self {
        Self {
            mongodb_default_database: default_db_name(),
            notes: "Edit agent-studio.yaml and restart to apply.".into(),
        }
    }
}
impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            workspace: WorkspaceCfg::default(),
            backend: BackendCfg::default(),
            database: DatabaseCfg::default(),
            connectors: ConnectorsCfg::default(),
            setup_complete: false,
        }
    }
}

/// Default workspace under the login home directory (`~/AgentStudio`).
pub fn default_workspace_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(DEFAULT_WORKSPACE_DIRNAME)
}

/// Writable app config directory (cross-platform).
/// - Windows: `%ProgramData%\AgentStudio` (fallback `%LOCALAPPDATA%\AgentStudio`)
/// - macOS: `~/Library/Application Support/AgentStudio`
/// - Linux: `~/.config/AgentStudio`
pub fn app_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(pd) = std::env::var("ProgramData") {
            let p = PathBuf::from(pd).join(APP_DIRNAME);
            if fs::create_dir_all(&p).is_ok() {
                return p;
            }
        }
        if let Some(local) = dirs::data_local_dir() {
            let p = local.join(APP_DIRNAME);
            let _ = fs::create_dir_all(&p);
            return p;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(support) = dirs::data_dir() {
            let p = support.join(APP_DIRNAME);
            let _ = fs::create_dir_all(&p);
            return p;
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(cfg) = dirs::config_dir() {
            let p = cfg.join(APP_DIRNAME);
            let _ = fs::create_dir_all(&p);
            return p;
        }
    }
    default_workspace_path()
}

/// Windows Program Files location when the installer used per-machine mode.
#[cfg(target_os = "windows")]
pub fn program_files_agentstudio_dir() -> Option<PathBuf> {
    let pf = std::env::var_os("ProgramFiles")?;
    Some(PathBuf::from(pf).join(APP_DIRNAME))
}

#[cfg(not(target_os = "windows"))]
pub fn program_files_agentstudio_dir() -> Option<PathBuf> {
    None
}

pub fn config_path_for_workspace(workspace: &Path) -> PathBuf {
    workspace.join(CONFIG_FILE_NAME)
}

pub fn app_config_path() -> PathBuf {
    app_config_dir().join(CONFIG_FILE_NAME)
}

/// Remembers workspace root across restarts.
pub fn workspace_pointer_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".vynelixai").join("agent-studio-workspace.txt")
}

/// Remembers which YAML is the active config.
pub fn config_pointer_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".vynelixai").join("agent-studio-config.txt")
}

pub fn read_path_pointer(file: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(file).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

pub fn write_path_pointer(file: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(file, target.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

pub fn resolve_workspace_path(preferred: Option<&str>) -> PathBuf {
    if let Some(raw) = preferred {
        let t = raw.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    if let Some(p) = read_path_pointer(&workspace_pointer_path()) {
        return p;
    }
    default_workspace_path()
}

/// Resolve the editable config file path (creates parent dirs as needed).
pub fn resolve_config_path(workspace: &Path) -> PathBuf {
    if let Ok(env) = std::env::var("AGENT_STUDIO_CONFIG") {
        let t = env.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    if let Some(p) = read_path_pointer(&config_pointer_path()) {
        if p.exists() {
            return p;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(pf) = program_files_agentstudio_dir() {
            let candidate = pf.join(CONFIG_FILE_NAME);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    let app = app_config_path();
    if app.exists() {
        return app;
    }
    let ws = config_path_for_workspace(workspace);
    if ws.exists() {
        return ws;
    }
    // Prefer app-data location for new installs (writable without admin)
    app
}

pub fn load_config(path: &Path) -> Result<DesktopConfig, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_yaml::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_config(path: &Path, cfg: &DesktopConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let header = "# Agent Studio — editable desktop config\n\
# Restart the app after changes. Backend + UI read this file on startup.\n\
# Mongo modes: local | atlas | iaas\n\n";
    let body = serde_yaml::to_string(cfg).map_err(|e| e.to_string())?;
    fs::write(path, format!("{header}{body}")).map_err(|e| e.to_string())
}

/// Write config to the primary path and mirror copies for discoverability.
pub fn save_config_mirrors(primary: &Path, cfg: &DesktopConfig, workspace: &Path) -> Result<(), String> {
    save_config(primary, cfg)?;
    write_path_pointer(&config_pointer_path(), primary)?;
    write_path_pointer(&workspace_pointer_path(), workspace)?;

    // Always keep a copy beside the workspace data tree
    let ws_cfg = config_path_for_workspace(workspace);
    if ws_cfg != primary {
        let _ = save_config(&ws_cfg, cfg);
    }

    // Windows: also try Program Files\AgentStudio when writable (per-machine install)
    #[cfg(target_os = "windows")]
    {
        if let Some(pf) = program_files_agentstudio_dir() {
            if fs::create_dir_all(&pf).is_ok() {
                let pf_cfg = pf.join(CONFIG_FILE_NAME);
                if pf_cfg != primary {
                    let _ = save_config(&pf_cfg, cfg);
                }
            }
        }
    }

    // Seed example next to primary for operators
    let example = primary
        .parent()
        .map(|p| p.join("agent-studio.yaml.example"));
    if let Some(ex) = example {
        if !ex.exists() {
            let _ = fs::write(&ex, example_template());
        }
    }

    Ok(())
}

pub fn ensure_workspace_layout(workspace: &Path) -> Result<(), String> {
    fs::create_dir_all(workspace).map_err(|e| e.to_string())?;
    fs::create_dir_all(workspace.join("data").join("runs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(workspace.join("data").join("plugins")).map_err(|e| e.to_string())?;
    let _ = fs::create_dir_all(app_config_dir());
    write_path_pointer(&workspace_pointer_path(), workspace)?;
    Ok(())
}

/// Ensure a starter config exists so first launch can open the setup wizard with a real path.
pub fn ensure_starter_config(workspace: &Path) -> Result<PathBuf, String> {
    ensure_workspace_layout(workspace)?;
    let cfg_path = resolve_config_path(workspace);
    if !cfg_path.exists() {
        let mut cfg = DesktopConfig::default();
        cfg.workspace.path = workspace.to_string_lossy().to_string();
        cfg.connectors.mongodb_default_database = cfg.database.name.clone();
        cfg.setup_complete = false;
        save_config_mirrors(&cfg_path, &cfg, workspace)?;
    }
    Ok(cfg_path)
}

pub fn example_template() -> &'static str {
    include_str!("../resources/agent-studio.yaml.example")
}

/// Build a Mongo URI for the chosen deployment mode.
pub fn uri_for_mode(mode: &str, uri: &str) -> String {
    let trimmed = uri.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    match mode {
        "atlas" => "mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority".into(),
        "iaas" => "mongodb://USER:PASSWORD@HOST:27017/?authSource=admin".into(),
        _ => default_db_uri(),
    }
}
