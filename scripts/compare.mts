/* Head-to-head: rules engine vs Gemma vs Mistral on labeled synthetic notes.
   Run: node --env-file=.env.local node_modules/.bin/tsx scripts/compare.ts */
import { NOTES } from "../src/data/fixtures";
import { evalC1, evalC2 } from "../src/lib/pipeline";
import { PROVIDERS, tryAssess, type NoteStatus, type ProviderId } from "../src/lib/llm";

type Case = { id: string; note: string; c1: NoteStatus; c2: NoteStatus };
const CASES: Case[] = [
  { id: "AUTH-1001", note: NOTES["AUTH-1001"], c1: "met", c2: "met" },
  { id: "AUTH-1002", note: NOTES["AUTH-1002"], c1: "not_met", c2: "not_met" },
  { id: "AUTH-1003", note: NOTES["AUTH-1003"], c1: "ambiguous", c2: "met" },
  { id: "AUTH-1004", note: NOTES["AUTH-1004"], c1: "met", c2: "met" },
  { id: "AUTH-1005", note: NOTES["AUTH-1005"], c1: "met", c2: "met" },
  { id: "AUTH-1006", note: NOTES["AUTH-1006"], c1: "met", c2: "met" },
  { id: "HARD-1 intact exam", note: "Patient reports 12 weeks of back pain. Physical therapy twice weekly for 7 weeks completed. Neuro exam: intact. Strength 5/5.", c1: "met", c2: "not_met" },
  { id: "HARD-2 started last week", note: "Started physical therapy last week. Radiculopathy with positive straight leg raise on the right.", c1: "not_met", c2: "met" },
  { id: "HARD-3 'six weeks' spelled out", note: "Six weeks of ibuprofen and home exercises without improvement. Exam shows foot drop on the left.", c1: "met", c2: "met" },
  { id: "HARD-4 cumulative therapy", note: "Completed 4 weeks of PT, then 3 more weeks of NSAIDs. Sensation decreased over the L5 dermatome.", c1: "met", c2: "met" },
  { id: "HARD-5 negated findings", note: "Pain for 8 weeks. Patient declined physical therapy and takes no medications. No numbness or weakness on exam.", c1: "not_met", c2: "not_met" },
  { id: "HARD-6 silent note", note: "Chief complaint: low back pain. No documentation of prior treatment. Exam not performed.", c1: "ambiguous", c2: "ambiguous" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asStatus = (s: string): NoteStatus => (s === "missing" ? "ambiguous" : (s as NoteStatus));

type Row = { id: string; c1?: NoteStatus; c2?: NoteStatus; failed?: string; ms: number };
const results: Record<string, Row[]> = { rules: CASES.map((c) => ({ id: c.id, c1: asStatus(evalC1(c.note).status), c2: asStatus(evalC2(c.note).status), ms: 0 })) };

for (const id of (process.env.ENGINES ?? "gemma,gemma31,mistral").split(",") as ProviderId[]) {
  if (!PROVIDERS[id].key) { console.log(`skip ${id}: no API key`); continue; }
  results[id] = [];
  for (const c of CASES) {
    const a = await tryAssess(c.note, id);
    results[id].push(a.result ? { id: c.id, c1: a.result.c1.status, c2: a.result.c2.status, ms: a.ms } : { id: c.id, failed: a.error, ms: a.ms });
    await sleep(1300); // stay under ~1 request/second
  }
}

const lines = ["| Engine | Judgments correct | Cases rejected/failed | Avg latency |", "|---|---|---|---|"];
for (const [name, rows] of Object.entries(results)) {
  let ok = 0, total = 0, failed = 0, ms = 0;
  for (const [i, r] of rows.entries()) {
    if (r.failed) { failed++; total += 2; continue; }
    total += 2; ms += r.ms;
    if (r.c1 === CASES[i].c1) ok++;
    if (r.c2 === CASES[i].c2) ok++;
  }
  const label = name === "rules" ? "Rules engine" : `${name} (${PROVIDERS[name as ProviderId].model})`;
  lines.push(`| ${label} | ${ok}/${total} | ${failed}/${rows.length} | ${name === "rules" ? "0 ms" : Math.round(ms / Math.max(1, rows.length - failed)) + " ms"} |`);
}
console.log("\n" + lines.join("\n") + "\n");
console.log("Disagreements with the labels:");
for (const [name, rows] of Object.entries(results))
  for (const [i, r] of rows.entries()) {
    const c = CASES[i];
    if (r.failed) console.log(`  ${name.padEnd(8)} ${c.id}: FAILED (${r.failed})`);
    else for (const k of ["c1", "c2"] as const) if (r[k] !== c[k]) console.log(`  ${name.padEnd(8)} ${c.id} ${k}: got ${r[k]}, expected ${c[k]}`);
  }
