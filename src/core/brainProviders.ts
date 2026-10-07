/** Shown immediately. The API list replaces this when the server is up. */
export const BRAIN_PROVIDER_OPTIONS = [
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", needsKey: false },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", needsKey: false },
  { id: "vllm", label: "vLLM (local)", baseUrl: "http://127.0.0.1:8000/v1", model: "local-model", needsKey: false },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  { id: "grok", label: "Grok", baseUrl: "https://api.x.ai/v1", model: "grok-3", needsKey: true },
  { id: "anthropic", label: "Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", needsKey: true },
  { id: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash", needsKey: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
] as const;
