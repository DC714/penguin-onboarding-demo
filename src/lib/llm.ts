/**
 * Optional open-weight model step. The model only reads the unstructured clinical
 * note. Anything it returns is verified in code (allowed status, quote must appear
 * verbatim in the note); on any failure the caller falls back to the rules engine.
 */
export type NoteStatus = "met" | "not_met" | "ambiguous";
export type NoteAssessment = { c1: { status: NoteStatus; quote: string }; c2: { status: NoteStatus; quote: string } };
export type ProviderId = "gemma" | "gemma31" | "mistral";
export type Attempt = { result: NoteAssessment | null; error?: string; ms: number };

type Provider = { id: ProviderId; label: string; model: string; key: string | undefined; call: (prompt: string, model: string, key: string) => Promise<string> };

const gemmaCall: Provider["call"] = async (prompt, model, key) => {
  // Gemma on the Gemini API has no system-prompt or JSON-mode support, so everything rides in the user turn.
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: process.env.GEMMA_THINKING ?? "minimal" } } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("") ?? "";
};

const mistralCall: Provider["call"] = async (prompt, model, key) => {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json())?.choices?.[0]?.message?.content ?? "";
};

/** Retry transient 5xx/429 responses with backoff; everything else is final. */
async function withRetry(fn: () => Promise<string>, tries = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!/HTTP (5\d\d|429)/.test(String(e))) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** First balanced {...} object in a string (models sometimes add prose or a second object). */
function firstJsonObject(text: string): string {
  const start = text.indexOf("{");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i >= 0 && i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return "";
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  gemma: { id: "gemma", label: "Gemma 26B", model: process.env.GEMMA_MODEL ?? "gemma-4-26b-a4b-it", key: process.env.GEMMA_API_KEY, call: gemmaCall },
  gemma31: { id: "gemma31", label: "Gemma 31B", model: process.env.GEMMA31_MODEL ?? "gemma-4-31b-it", key: process.env.GEMMA_API_KEY, call: gemmaCall },
  mistral: { id: "mistral", label: "Mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest", key: process.env.MISTRAL_API_KEY, call: mistralCall },
};

// Only models with a configured key are offered in the UI (the 31B and Mistral entries stay available to the benchmark script).
export const availableProviders = () => (Object.values(PROVIDERS)).filter((p) => p.id === "gemma").map((p) => ({ id: p.id, name: p.model, label: p.label, available: Boolean(p.key) }));

const PROMPT = (note: string) => `You are a utilization-review assistant reading ONE clinical note against two policy criteria.

C1: At least 6 weeks of documented conservative therapy (physical therapy, NSAIDs, or medication).
C2: Objective neurological deficit or radiculopathy on exam.

Rules:
- "met" only if the note clearly satisfies the criterion. For C1 the duration must be stated as 6 weeks or more.
- "not_met" if the note shows it is not satisfied (for example therapy not started, shorter than 6 weeks, or a normal neuro exam).
- "ambiguous" if the note is vague (for example "several weeks" or "some" therapy) or silent.
- "quote" must be copied EXACTLY, character for character, from the note. Use "" if the note has nothing relevant.

Reply with JSON only, no prose and no code fences, in this shape:
{"c1":{"status":"met|not_met|ambiguous","quote":"..."},"c2":{"status":"met|not_met|ambiguous","quote":"..."}}

NOTE:
"""${note}"""`;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function tryAssess(note: string, id: ProviderId): Promise<Attempt> {
  const p = PROVIDERS[id];
  const t0 = Date.now();
  if (!p.key || !note) return { result: null, error: "no key or empty note", ms: 0 };
  try {
    const text = await withRetry(() => p.call(PROMPT(note), p.model, p.key!));
    const json = JSON.parse(firstJsonObject(text));
    const out = {} as NoteAssessment;
    for (const k of ["c1", "c2"] as const) {
      const { status, quote } = json[k] ?? {};
      if (!["met", "not_met", "ambiguous"].includes(status) || typeof quote !== "string") throw new Error("bad schema");
      if (quote && !norm(note).includes(norm(quote))) throw new Error("quote not found in note (hallucinated evidence)");
      out[k] = { status, quote };
    }
    return { result: out, ms: Date.now() - t0 };
  } catch (e) {
    return { result: null, error: String(e instanceof Error ? e.message : e), ms: Date.now() - t0 };
  }
}

export const assessNote = async (note: string, id: ProviderId) => (await tryAssess(note, id)).result;

/** Free-text generation (used for the kickoff summary). Returns null if the model is unavailable. */
export async function draftText(prompt: string, id: ProviderId = "gemma"): Promise<string | null> {
  const p = PROVIDERS[id];
  if (!p.key) return null;
  try {
    const text = (await withRetry(() => p.call(prompt, p.model, p.key!))).trim();
    return text || null;
  } catch {
    return null;
  }
}
