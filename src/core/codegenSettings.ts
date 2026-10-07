const PROVIDER_KEY = "vynelix-codegen-provider";
const MODEL_KEY = "vynelix-codegen-model";
const BASE_KEY = "vynelix-codegen-base-url";
const API_KEY = "vynelix-codegen-api-key";

export type CodegenSettings = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};

const DEFAULTS: CodegenSettings = {
  provider: "openai",
  model: "gpt-4.1-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
};

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function loadCodegenSettings(): CodegenSettings {
  return {
    provider: read(PROVIDER_KEY) || DEFAULTS.provider,
    model: read(MODEL_KEY) || DEFAULTS.model,
    baseUrl: read(BASE_KEY) || DEFAULTS.baseUrl,
    apiKey: read(API_KEY),
  };
}

export function saveCodegenSettings(next: Partial<CodegenSettings>) {
  const cur = { ...loadCodegenSettings(), ...next };
  try {
    localStorage.setItem(PROVIDER_KEY, cur.provider);
    localStorage.setItem(MODEL_KEY, cur.model);
    localStorage.setItem(BASE_KEY, cur.baseUrl);
    if (cur.apiKey) localStorage.setItem(API_KEY, cur.apiKey);
    else localStorage.removeItem(API_KEY);
  } catch {
    /* ignore */
  }
  return cur;
}
