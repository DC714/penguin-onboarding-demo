/**
 * Optional open-weight model step (Gemma via the Google AI Studio API).
 * The model only reads the unstructured clinical note. Anything it returns is
 * verified in code (allowed status, quote must appear verbatim in the note);
 * on any failure the caller falls back to the deterministic rules engine.
 */
export type NoteStatus = "met" | "not_met" | "ambiguous";
export type NoteAssessment = { c1: { status: NoteStatus; quote: string }; c2: { status: NoteStatus; quote: string } };

export const MODEL = process.env.GEMMA_MODEL ?? "gemma-3-27b-it";
export const modelAvailable = () => Boolean(process.env.GEMMA_API_KEY);

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

export async function assessNote(note: string): Promise<NoteAssessment | null> {
  const key = process.env.GEMMA_API_KEY;
  if (!key || !note) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT(note) }] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const out = {} as NoteAssessment;
    for (const k of ["c1", "c2"] as const) {
      const { status, quote } = json[k] ?? {};
      if (!["met", "not_met", "ambiguous"].includes(status) || typeof quote !== "string") return null;
      if (quote && !norm(note).includes(norm(quote))) return null; // hallucinated evidence: reject whole answer
      out[k] = { status, quote };
    }
    return out;
  } catch {
    return null;
  }
}
