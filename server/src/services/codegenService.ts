/**
 * Optional LLM polish for downloadable node reference Python.
 * Uses a dedicated OpenAI-compatible model/key — never logs the key.
 */

export async function enhanceNodeClasses(input: {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  nodes: Array<{ id: string; type: string; label: string; source: string }>;
}): Promise<Array<{ id: string; source: string }>> {
  const base = input.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const out: Array<{ id: string; source: string }> = [];
  for (const node of input.nodes) {
    const source = await polishOne({
      url,
      apiKey: input.apiKey,
      model: input.model,
      node,
    });
    out.push({ id: node.id, source });
  }
  return out;
}

async function polishOne(opts: {
  url: string;
  apiKey: string;
  model: string;
  node: { id: string; type: string; label: string; source: string };
}): Promise<string> {
  const body = {
    model: opts.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You polish Agent Studio node reference Python. Keep the same class name, TYPE, DISPLAY_NAME, PARAMS, and execute(self, items, ctx) -> list[dict] with n8n items [{json: row}]. Improve comments, docstrings, and live SDK snippets (pymongo, SQL, boto3, httpx) using PARAMS. Never invent secrets. Never wrap in markdown fences. Return only Python.",
      },
      {
        role: "user",
        content: `Node ${opts.node.label} (${opts.node.type} / ${opts.node.id}).\n\n${opts.node.source}`,
      },
    ],
  };
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`codegen model HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("codegen model returned non-JSON");
  }
  const content = parsed.choices?.[0]?.message?.content ?? "";
  const cleaned = stripFence(content).trim();
  if (!cleaned.includes("def execute")) return opts.node.source;
  return cleaned;
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:python)?\n([\s\S]*?)\n```$/);
  return match ? match[1] : trimmed;
}
