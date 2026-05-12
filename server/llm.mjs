// LLM client. Mirrors gridiron/llm.py — talk directly to whatever's hot on
// LLM_BASE_URL (ollama, lm studio, llama-server). No VRAM coordination.
//
// Qwen-mode renders a chat template with empty <think></think> to suppress
// thinking and uses /v1/completions. /v1/chat/completions mode is the
// fallback for non-Qwen models.

const BASE_URL  = String(process.env.LLM_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const MODEL     = String(process.env.LLM_MODEL || "qwen3:14b");
const API_KEY   = String(process.env.LLM_API_KEY || "");
const QWEN_MODE = String(process.env.LLM_QWEN_MODE || "true").toLowerCase() === "true";
const TIMEOUT   = Number(process.env.LLM_TIMEOUT_MS || 120_000);
const RETRIES   = Number(process.env.LLM_MAX_RETRIES || 2);

function apiUrl(path) {
  const base = BASE_URL.endsWith("/v1") ? BASE_URL : `${BASE_URL}/v1`;
  return `${base}${path}`;
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

async function postJson(url, payload, { timeout = TIMEOUT } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      if (attempt < RETRIES) {
        const wait = 1000 * 2 ** attempt;
        console.warn(`[llm] request failed (attempt ${attempt + 1}): ${err.message} — retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`LLM request failed after ${RETRIES + 1} attempts: ${lastErr?.message || lastErr}`);
}

export function stripThinking(text) {
  return String(text || "").replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim();
}

function renderQwenPrompt(system, user) {
  return [
    `<|im_start|>system\n${system}<|im_end|>`,
    `<|im_start|>user\n${user}<|im_end|>`,
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`,
  ].join("\n");
}

export async function complete({
  system,
  user,
  temperature = 0.7,
  maxTokens = 2000,
  model = MODEL,
  timeout,
}) {
  if (QWEN_MODE) {
    const data = await postJson(apiUrl("/completions"), {
      model: model || "auto",
      prompt: renderQwenPrompt(system, user),
      temperature,
      max_tokens: maxTokens,
      stop: ["<|im_end|>", "<|endoftext|>"],
    }, { timeout });
    const text = data?.choices?.[0]?.text || "";
    if (!text.trim()) throw new Error("Empty response from LLM");
    return stripThinking(text);
  }

  const data = await postJson(apiUrl("/chat/completions"), {
    model: model || "auto",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  }, { timeout });
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("Empty response from LLM");
  return stripThinking(text);
}

export async function llmHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(apiUrl("/models"), { headers: headers(), signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      base_url: BASE_URL,
      model: MODEL,
      qwen_mode: QWEN_MODE,
      available_models: Array.isArray(data?.data) ? data.data.map((m) => m.id) : [],
    };
  } catch (err) {
    return {
      ok: false,
      base_url: BASE_URL,
      model: MODEL,
      qwen_mode: QWEN_MODE,
      error: String(err?.message || err),
    };
  }
}

export const llmConfig = {
  baseUrl: BASE_URL,
  model: MODEL,
  qwenMode: QWEN_MODE,
};
