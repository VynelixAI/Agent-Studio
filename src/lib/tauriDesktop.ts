import { invoke } from "@tauri-apps/api/core";

export type MongoDeployMode = "local" | "atlas" | "iaas";

export type DesktopConfig = {
  workspace: { path: string };
  backend: { host: string; port: number; api_url: string };
  database: { mode: string; name: string; uri: string };
  connectors: {
    mongodb_default_database: string;
    notes: string;
  };
  setup_complete: boolean;
};

export type DesktopStatus = {
  isDesktop: boolean;
  workspacePath: string;
  configPath: string;
  appConfigDir: string;
  config: DesktopConfig;
  backendApiUrl: string;
  backendReady: boolean;
  setupNeeded: boolean;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDefaultWorkspacePath(): Promise<string> {
  return invoke<string>("get_default_workspace_path");
}

export async function getAppConfigDir(): Promise<string> {
  return invoke<string>("get_app_config_dir");
}

export async function getDesktopStatus(): Promise<DesktopStatus> {
  return invoke<DesktopStatus>("get_desktop_status");
}

export async function completeDesktopSetup(input: {
  workspacePath?: string;
  mongoMode?: MongoDeployMode;
  databaseName: string;
  databaseUri: string;
  backendPort?: number;
  apiUrl?: string;
  mongodbDefaultDatabase?: string;
  connectorNotes?: string;
}): Promise<DesktopStatus> {
  return invoke<DesktopStatus>("complete_desktop_setup", { input });
}

export async function restartDesktopBackend(): Promise<DesktopStatus> {
  return invoke<DesktopStatus>("restart_desktop_backend");
}

export async function openConfigFile(): Promise<string> {
  return invoke<string>("open_config_file");
}

export async function openConfigFolder(): Promise<string> {
  return invoke<string>("open_config_folder");
}
