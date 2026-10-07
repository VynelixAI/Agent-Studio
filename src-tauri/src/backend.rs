//! Spawn / stop the Agent Studio API alongside the Tauri UI.

use crate::config::{self, DesktopConfig};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct BackendState {
    pub child: Mutex<Option<Child>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

fn find_node() -> Option<PathBuf> {
    which::which("node").ok()
}

/// Resolve server entry: packaged resource or repo `server` during `tauri dev`.
fn resolve_server_entry(app: &AppHandle) -> Option<(PathBuf, Vec<String>)> {
    // Packaged: resources/server/dist/index.js
    if let Ok(res) = app.path().resource_dir() {
        let dist = res.join("server").join("dist").join("index.js");
        if dist.exists() {
            return Some((dist, vec![]));
        }
        let src = res.join("server").join("src").join("index.ts");
        if src.exists() {
            return Some((src, vec![]));
        }
    }

    // Dev: sibling server/ next to src-tauri
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let server_root = manifest.join("..").join("server");
    let ts = server_root.join("src").join("index.ts");
    if ts.exists() {
        return Some((ts, vec![]));
    }
    let js = server_root.join("dist").join("index.js");
    if js.exists() {
        return Some((js, vec![]));
    }
    None
}

pub fn stop_backend(state: &BackendState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn start_backend(app: &AppHandle, cfg: &DesktopConfig, cfg_path: &Path) -> Result<String, String> {
    let state = app.state::<BackendState>();
    stop_backend(&state);

    let workspace = if cfg.workspace.path.trim().is_empty() {
        cfg_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(config::default_workspace_path)
    } else {
        PathBuf::from(cfg.workspace.path.trim())
    };

    let runs = workspace.join("data").join("runs");
    let plugins = workspace.join("data").join("plugins");
    let _ = std::fs::create_dir_all(&runs);
    let _ = std::fs::create_dir_all(&plugins);

    let port = cfg.backend.port.to_string();
    let mut envs: Vec<(String, String)> = vec![
        ("AGENT_STUDIO_CONFIG".into(), cfg_path.to_string_lossy().into()),
        ("PORT".into(), port.clone()),
        ("MONGODB_URI".into(), cfg.database.uri.clone()),
        ("MONGODB_DB".into(), cfg.database.name.clone()),
        ("RUNS_ROOT".into(), runs.to_string_lossy().into()),
        ("PLUGINS_ROOT".into(), plugins.to_string_lossy().into()),
        ("CORS_ORIGIN".into(), "*".into()),
        ("NODE_ENV".into(), "production".into()),
    ];

    // Prefer external sidecar binary when present (release packaging)
    let sidecar = app
        .path()
        .resource_dir()
        .ok()
        .map(|r| r.join("binaries").join("agent-studio-api"))
        .filter(|p| p.exists());

    let mut child = if let Some(bin) = sidecar {
        let mut cmd = Command::new(&bin);
        for (k, v) in &envs {
            cmd.env(k, v);
        }
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start API sidecar: {e}"))?
    } else {
        let node = find_node().ok_or_else(|| {
            "Node.js not found on PATH. Install Node 20+ or bundle the API sidecar.".to_string()
        })?;
        let (entry, _) = resolve_server_entry(app).ok_or_else(|| {
            "Agent Studio API entry not found (server/dist or server/src).".to_string()
        })?;

        let mut cmd = Command::new(&node);
        for (k, v) in &envs {
            cmd.env(k, v);
        }

        if entry.extension().and_then(|e| e.to_str()) == Some("ts") {
            // Dev / unpackaged: use npx tsx
            let server_cwd = entry
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| entry.clone());
            cmd = Command::new("npx");
            for (k, v) in &envs {
                cmd.env(k, v);
            }
            cmd.arg("tsx")
                .arg(&entry)
                .current_dir(server_cwd)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
        } else {
            let server_cwd = entry
                .parent() // dist
                .and_then(|p| p.parent()) // server root (with node_modules)
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| entry.clone());
            cmd.arg(&entry)
                .current_dir(server_cwd)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
        }

        cmd.spawn()
            .map_err(|e| format!("Failed to start API with Node: {e}"))?
    };

    let pid = child.id();
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    Ok(format!(
        "Backend started (pid {pid}) on port {} · config {}",
        cfg.backend.port,
        cfg_path.display()
    ))
}

pub async fn wait_for_health(host: &str, port: u16, attempts: u32) -> bool {
    let socket = if host == "0.0.0.0" || host == "127.0.0.1" || host == "localhost" {
        std::net::SocketAddr::from(([127, 0, 0, 1], port))
    } else {
        format!("{host}:{port}")
            .parse()
            .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], port)))
    };
    for _ in 0..attempts {
        if std::net::TcpStream::connect_timeout(&socket, std::time::Duration::from_millis(250))
            .is_ok()
        {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
    false
}
