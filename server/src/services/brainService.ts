/**
 * Workspace Brain — one model per workspace.
 * Local servers (Ollama, LM Studio, vLLM) and cloud APIs share this call.
 * OpenAI-compatible hosts use /chat/completions. Claude and Gemini use their own APIs.
 */
import { brainContext, readBrain, readChat, type BrainConfig } from "./localWorkspace.js";

export interface BrainProvider {
  id: string;
  label: string;
  kind: "openai" | "anthropic" | "google";
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export const BRAIN_PROVIDERS: BrainProvider[] = [
  { id: "ollama", label: "Ollama (local)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", needsKey: false },
  { id: "lmstudio", label: "LM Studio (local)", kind: "openai", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", needsKey: false },
  { id: "vllm", label: "vLLM (local)", kind: "openai", baseUrl: "http://127.0.0.1:8000/v1", model: "local-model", needsKey: false },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  { id: "grok", label: "Grok", kind: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-3", needsKey: true },
  { id: "anthropic", label: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", needsKey: true },
  { id: "gemini", label: "Gemini", kind: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash", needsKey: true },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
];

export function providerById(id: string): BrainProvider {
  return BRAIN_PROVIDERS.find((p) => p.id === id) ?? BRAIN_PROVIDERS[0];
}

const SYSTEM = `You are the Workspace Brain for Vynelix Agent Studio.
You can see this workspace's node memory (latest input and output of each node) and the last 5 executions.
Answer in plain language. Explain nodes, failures, and data flow. Suggest concrete graph changes.
When the user describes a new agent, propose nodes in a short list (type, label, why) they can build on the canvas.
Do not invent secret values. If memory is empty, say the workspace has not run yet and still help them design it.`;

export async function askBrain(input: {
  workspaceId: string;
  message: string;
  graphSummary?: string;
}): Promise<{ reply: string; provider: string; model: string }> {
  const cfg = await readBrain(input.workspaceId);
  const spec = providerById(cfg.provider);
  if (spec.needsKey && !cfg.apiKey) {
    throw Object.assign(
      new Error(`Add an API key for ${spec.label} in the Workspace Brain panel.`),
      { statusCode: 400 },
    );
  }
  const history = await readChat(input.workspaceId);
  const context = await brainContext(input.workspaceId);
  const user = [
    input.graphSummary ? `Current canvas:\n${input.graphSummary}` : "",
    `Workspace memory and last executions:\n${context}`,
    `Question:\n${input.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(spec, cfg, history.slice(-12), user);
  return { reply, provider: cfg.provider, model: cfg.model };
}

async function complete(
  spec: BrainProvider,
  cfg: BrainConfig,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  user: string,
): Promise<string> {
  const model = cfg.model || spec.model;
  const base = (cfg.baseUrl || spec.baseUrl).replace(/\/$/, "");
  if (spec.kind === "anthropic") return completeAnthropic(base, cfg.apiKey || "", model, history, user);
  if (spec.kind === "google") return completeGemini(base, cfg.apiKey || "", model, history, user);
  return completeOpenAI(base, cfg.apiKey || "", model, history, user, spec.needsKey);
}

async function completeOpenAI(
  base: string,
  apiKey: string,
  model: string,
  history: Array<{ role: string; content: string }>,
  user: string,
  needsKey: boolean,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  else if (needsKey) headers.Authorization = "Bearer local";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(modelError("model", res.status, text)), { statusCode: 502 });
  }
  const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  return (parsed.choices?.[0]?.message?.content ?? "").trim() || "(empty reply)";
}

async function completeAnthropic(
  base: string,
  apiKey: string,
  model: string,
  history: Array<{ role: string; content: string }>,
  user: string,
): Promise<string> {
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [
        ...history.map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.content })),
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(modelError("Claude", res.status, text)), { statusCode: 502 });
  }
  const parsed = JSON.parse(text) as { content?: Array<{ text?: string }> };
  return (parsed.content?.map((c) => c.text ?? "").join("") ?? "").trim() || "(empty reply)";
}

async function completeGemini(
  base: string,
  apiKey: string,
  model: string,
  history: Array<{ role: string; content: string }>,
  user: string,
): Promise<string> {
  const contents = [
    ...history.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    })),
    { role: "user", parts: [{ text: user }] },
  ];
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(modelError("Gemini", res.status, text)), { statusCode: 502 });
  }
  const parsed = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim() || "(empty reply)";
}

function modelError(who: string, status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").slice(0, 280);
  return `${who} returned HTTP ${status}. ${snippet}`;
}
