/**
 * Generate Python / JavaScript stubs for LLM & Agent nodes from natural-language intent.
 * Used when the operator describes what they need instead of writing code by hand.
 */

export type AiCodeLanguage = "python" | "javascript";
export type AiNodeKind = "llm" | "agent";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function summarizeIntent(intent: string): string {
  const t = intent.trim().replace(/\s+/g, " ");
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

function detectHints(intent: string) {
  const lower = intent.toLowerCase();
  return {
    json: /\bjson\b|structured|schema|extract fields/.test(lower),
    summarize: /summar|tl;dr|overview/.test(lower),
    classify: /classif|categor|label|sentiment|score/.test(lower),
    transform: /transform|map|clean|normalize|enrich/.test(lower),
    sql: /\bsql\b|query|select /.test(lower),
    tools: /tool|search|mongo|api|browser|calculator/.test(lower),
    rag: /\brag\b|retriev|document|knowledge/.test(lower),
  };
}

export function generateDynamicCode(opts: {
  kind: AiNodeKind;
  language: AiCodeLanguage;
  intent: string;
  provider?: string;
  model?: string;
}): string {
  const intent = opts.intent.trim() || "Process upstream stage data with the configured model";
  const hints = detectHints(intent);
  const title = summarizeIntent(intent);

  if (opts.kind === "llm") {
    return opts.language === "python"
      ? llmPython(title, intent, hints, opts.provider, opts.model)
      : llmJavascript(title, intent, hints, opts.provider, opts.model);
  }
  return opts.language === "python"
    ? agentPython(title, intent, hints)
    : agentJavascript(title, intent, hints);
}

function llmPython(
  title: string,
  intent: string,
  hints: ReturnType<typeof detectHints>,
  provider?: string,
  model?: string,
): string {
  const responseHint = hints.json
    ? 'response_format={"type": "json_object"}'
    : "response_format=None";
  return `"""Auto-generated LLM node code
Intent: ${title}
Provider: ${provider ?? "openai"} · Model: ${model ?? "(from config)"}
Edit freely — stages dict is injected by the runtime.
"""
from __future__ import annotations
from typing import Any

INTENT = """${intent.replace(/"""/g, "'''")}"""

def build_messages(stages: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, str]]:
    """Build chat messages from upstream stages + intent."""
    system = ctx.get("system_prompt") or (
        "You are a data engineering assistant. Follow INTENT exactly."
    )
    # Prefer explicit user_prompt template from node config when present
    user_tmpl = ctx.get("user_prompt") or INTENT
    payload = {
        "intent": INTENT,
        "stages": {k: _preview(v) for k, v in stages.items()},
        "run": ctx.get("run"),
    }
    user = user_tmpl if "{{" not in str(user_tmpl) else str(user_tmpl)
    # Simple mustache-ish: expose stages JSON when template empty of jinja
    if user == INTENT or not str(user_tmpl).strip():
        user = f"{INTENT}\\n\\nContext:\\n{_preview(payload)}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

def postprocess(raw: str, stages: dict[str, Any], ctx: dict[str, Any]) -> Any:
    """Optional transform of model output before writing the stage."""
${hints.json ? `    import json
    try:
        return json.loads(raw)
    except Exception:
        return {"text": raw, "parse_error": True}
` : hints.classify ? `    text = (raw or "").strip().lower()
    label = "unknown"
    for candidate in ("high", "medium", "low", "positive", "negative", "neutral"):
        if candidate in text:
            label = candidate
            break
    return {"label": label, "raw": raw}
` : hints.summarize ? `    return {"summary": (raw or "").strip(), "source_stages": list(stages.keys())}
` : `    return raw
`}
def run(stages: dict[str, Any], ctx: dict[str, Any]) -> Any:
    """
    Runtime contract:
      - ctx['llm_complete'](messages, **kwargs) calls the configured provider/model
      - return value is written to the node output stage
    """
    messages = build_messages(stages, ctx)
    raw = ctx["llm_complete"](
        messages,
        ${responseHint},
        temperature=ctx.get("temperature"),
    )
    return postprocess(raw, stages, ctx)

def _preview(value: Any, limit: int = 4000) -> Any:
    import json
    try:
        text = json.dumps(value, default=str)
    except Exception:
        text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"
`;
}

function llmJavascript(
  title: string,
  intent: string,
  hints: ReturnType<typeof detectHints>,
  provider?: string,
  model?: string,
): string {
  return `/**
 * Auto-generated LLM node code
 * Intent: ${esc(title)}
 * Provider: ${provider ?? "openai"} · Model: ${model ?? "(from config)"}
 */
const INTENT = ${JSON.stringify(intent)};

function buildMessages(stages, ctx) {
  const system =
    ctx.system_prompt ||
    "You are a data engineering assistant. Follow INTENT exactly.";
  let user = ctx.user_prompt || INTENT;
  if (!ctx.user_prompt || String(ctx.user_prompt).trim() === "") {
    user = INTENT + "\\n\\nContext:\\n" + preview(stages);
  }
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function postprocess(raw, stages, ctx) {
${hints.json ? `  try { return JSON.parse(raw); } catch { return { text: raw, parse_error: true }; }` : hints.classify ? `  const text = String(raw || "").toLowerCase();
  const labels = ["high", "medium", "low", "positive", "negative", "neutral"];
  const label = labels.find((l) => text.includes(l)) || "unknown";
  return { label, raw };` : hints.summarize ? `  return { summary: String(raw || "").trim(), source_stages: Object.keys(stages || {}) };` : `  return raw;`}
}

/** Runtime: ctx.llmComplete(messages, opts) → string */
export async function run(stages, ctx) {
  const messages = buildMessages(stages, ctx);
  const raw = await ctx.llmComplete(messages, {
    temperature: ctx.temperature,
    responseFormat: ${hints.json ? `"json"` : `"text"`},
  });
  return postprocess(raw, stages, ctx);
}

function preview(value, limit = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}
`;
}

function agentPython(title: string, intent: string, hints: ReturnType<typeof detectHints>): string {
  const defaultTools = hints.rag
    ? `["rag_search", "mongo_query"]`
    : hints.sql
      ? `["sql_query", "mongo_query"]`
      : hints.tools
        ? `["mongo_query", "rest_get", "web_search"]`
        : `["mongo_query", "rest_get"]`;

  return `"""Auto-generated Agent node code
Intent: ${title}
"""
from __future__ import annotations
from typing import Any

INTENT = """${intent.replace(/"""/g, "'''")}"""

def choose_tools(ctx: dict[str, Any]) -> list[str]:
    """Return tool ids the agent may call this turn."""
    allowed = ctx.get("tools") or ${defaultTools}
    return list(allowed)

def build_system_prompt(ctx: dict[str, Any]) -> str:
    base = ctx.get("system_prompt") or "You are an autonomous data agent."
    return f"{base}\\n\\nGoal:\\n{INTENT}\\nUse tools sparingly; prefer structured JSON answers."

def should_stop(step: int, observation: Any, ctx: dict[str, Any]) -> bool:
    max_steps = int(ctx.get("max_steps") or 8)
    if step >= max_steps:
        return True
    if isinstance(observation, dict) and observation.get("final"):
        return True
    return False

def run(stages: dict[str, Any], ctx: dict[str, Any]) -> Any:
    """
    Runtime contract:
      ctx['agent_step'](messages, tools) → {content, tool_calls, observation}
    """
    messages = [
        {"role": "system", "content": build_system_prompt(ctx)},
        {
            "role": "user",
            "content": f"{INTENT}\\n\\nStages: {list(stages.keys())}",
        },
    ]
    tools = choose_tools(ctx)
    history: list[Any] = []
    for step in range(1, int(ctx.get("max_steps") or 8) + 1):
        result = ctx["agent_step"](messages, tools)
        history.append({"step": step, "result": result})
        if should_stop(step, result, ctx):
            return {
                "intent": INTENT,
                "final": result.get("content") if isinstance(result, dict) else result,
                "steps": history,
            }
        # Feed tool observations back
        if isinstance(result, dict) and result.get("observation") is not None:
            messages.append({"role": "assistant", "content": str(result.get("content") or "")})
            messages.append({"role": "tool", "content": str(result["observation"])})
    return {"intent": INTENT, "final": history[-1] if history else None, "steps": history}
`;
}

function agentJavascript(title: string, intent: string, hints: ReturnType<typeof detectHints>): string {
  const defaultTools = hints.rag
    ? `["rag_search", "mongo_query"]`
    : hints.sql
      ? `["sql_query", "mongo_query"]`
      : hints.tools
        ? `["mongo_query", "rest_get", "web_search"]`
        : `["mongo_query", "rest_get"]`;

  return `/**
 * Auto-generated Agent node code
 * Intent: ${esc(title)}
 */
const INTENT = ${JSON.stringify(intent)};

export function chooseTools(ctx) {
  return ctx.tools || ${defaultTools};
}

export function buildSystemPrompt(ctx) {
  const base = ctx.system_prompt || "You are an autonomous data agent.";
  return \`\${base}\\n\\nGoal:\\n\${INTENT}\\nPrefer structured JSON answers.\`;
}

export function shouldStop(step, observation, ctx) {
  const maxSteps = Number(ctx.max_steps || 8);
  if (step >= maxSteps) return true;
  if (observation && typeof observation === "object" && observation.final) return true;
  return false;
}

/** Runtime: ctx.agentStep(messages, tools) → { content, tool_calls, observation } */
export async function run(stages, ctx) {
  const messages = [
    { role: "system", content: buildSystemPrompt(ctx) },
    { role: "user", content: INTENT + "\\n\\nStages: " + Object.keys(stages || {}).join(", ") },
  ];
  const tools = chooseTools(ctx);
  const history = [];
  const maxSteps = Number(ctx.max_steps || 8);
  for (let step = 1; step <= maxSteps; step++) {
    const result = await ctx.agentStep(messages, tools);
    history.push({ step, result });
    if (shouldStop(step, result, ctx)) {
      return { intent: INTENT, final: result?.content ?? result, steps: history };
    }
    if (result?.observation != null) {
      messages.push({ role: "assistant", content: String(result.content || "") });
      messages.push({ role: "tool", content: String(result.observation) });
    }
  }
  return { intent: INTENT, final: history.at(-1) ?? null, steps: history };
}
`;
}

/** True if text looks like prose intent rather than already-written code */
export function looksLikeIntentNotCode(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(def |class |import |export |function |const |async |from |#!)/m.test(t)) {
    return false;
  }
  if (t.includes("{") && t.includes("}") && t.split("\n").length > 5) return false;
  return t.split(/\s+/).length >= 3;
}
