import { q } from "@/lib/db";
import { draftText, firstJsonObject } from "@/lib/llm";

/* All numbers here are synthetic and illustrative. They are NOT Penguin Ai data. */

const CASES = [138, 142, 140, 146, 152, 160, 168, 172, 180, 186, 192, 198];
const AUTO_RATE = [0, 0, 0, 0, 0.38, 0.44, 0.61, 0.66, 0.7, 0.72, 0.74, 0.75];
const INFO_RATE = [0.12, 0.13, 0.12, 0.12, 0.14, 0.13, 0.05, 0.04, 0.04, 0.03, 0.03, 0.03];
const REVIEW_MIN = [30.4, 29.8, 30.1, 29.5, 18.2, 14.9, 10.4, 9.1, 8.2, 7.6, 7.1, 6.8];
const OVERRIDES = [0, 0, 0, 0, 14, 11, 9, 6, 5, 4, 4, 3];
const ACTIVE = [4, 4, 4, 4, 6, 7, 8, 9, 10, 10, 10, 10];
export const MILESTONES = [{ week: 5, label: "Go-live" }, { week: 7, label: "NPI directory fix" }];
const REVIEWERS_TOTAL = 12;

const OVERRIDE_ROWS = [
  [5, "AUTH-2104", "Policy ambiguity", "Reviewer accepted 5 weeks of PT plus a documented home program as meeting the 6-week criterion."],
  [5, "AUTH-2111", "Note missing detail", "Therapy duration was in the PT discharge summary, not the ordering note."],
  [6, "AUTH-2162", "Prior imaging window", "Earlier MRI was for a different body region; criterion C3 should be region-specific."],
  [6, "AUTH-2170", "Policy ambiguity", "Reviewer treated 'several weeks' of therapy as met after a call with the clinic."],
  [7, "AUTH-2203", "Provider data", "Valid NPI existed under a second practice location; directory match missed it."],
  [8, "AUTH-2251", "Note missing detail", "Neuro deficit documented in a nursing note attached as a separate file."],
  [9, "AUTH-2298", "Prior imaging window", "Repeat MRI within 12 months justified by a new neurological deficit."],
  [11, "AUTH-2367", "Policy ambiguity", "Conservative therapy included chiropractic care, which the policy does not mention."],
] as const;

async function ensure() {
  await q(`CREATE TABLE IF NOT EXISTS weekly_metrics (week int PRIMARY KEY, cases int, auto_approved int, human_review int, info_requested int, avg_review_min float8, overrides int, reviewers_active int, reviewers_total int)`);
  await q(`CREATE TABLE IF NOT EXISTS reviewer_overrides (id serial PRIMARY KEY, week int, auth_ref text, category text, reason text)`);
  await q(`CREATE TABLE IF NOT EXISTS feature_requests (id serial PRIMARY KEY, raw text, title text, problem text, evidence text, proposal text, severity text, area text, drafted_by text, created_at timestamptz DEFAULT now())`);
  const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM weekly_metrics`);
  if (n > 0) return;
  const rows = CASES.map((c, i) => {
    const auto = Math.round(c * AUTO_RATE[i]);
    const info = Math.round(c * INFO_RATE[i]);
    return { week: i + 1, cases: c, auto_approved: auto, human_review: c - auto - info, info_requested: info, avg_review_min: REVIEW_MIN[i], overrides: OVERRIDES[i], reviewers_active: ACTIVE[i], reviewers_total: REVIEWERS_TOTAL };
  });
  await q(
    `INSERT INTO weekly_metrics SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(week int, cases int, auto_approved int, human_review int, info_requested int, avg_review_min float8, overrides int, reviewers_active int, reviewers_total int)`,
    [JSON.stringify(rows)],
  );
  await q(
    `INSERT INTO reviewer_overrides(week, auth_ref, category, reason) SELECT week, auth_ref, category, reason FROM jsonb_to_recordset($1::jsonb) AS x(week int, auth_ref text, category text, reason text)`,
    [JSON.stringify(OVERRIDE_ROWS.map(([week, auth_ref, category, reason]) => ({ week, auth_ref, category, reason })))],
  );
}

type Row = Record<string, number>;

export async function getValue() {
  await ensure();
  const weekly = await q<Row>(`SELECT * FROM weekly_metrics ORDER BY week`);
  const overrides = await q(`SELECT week, auth_ref, category, reason FROM reviewer_overrides ORDER BY week DESC, id DESC`);
  const requests = await q(`SELECT id, title, problem, evidence, proposal, severity, area, drafted_by, created_at FROM feature_requests ORDER BY id DESC LIMIT 8`);

  const trend = weekly.map((w) => ({
    week: `W${w.week}`,
    "Auto-resolved %": Math.round((w.auto_approved / w.cases) * 100),
    "Info requested %": Math.round((w.info_requested / w.cases) * 100),
    "Avg review minutes": w.avg_review_min,
    Overrides: w.overrides,
  }));
  const base = weekly.slice(0, 4);
  const last = weekly[weekly.length - 1];
  const baseMin = base.reduce((a, w) => a + w.avg_review_min, 0) / base.length;
  const aiWeeks = weekly.filter((w) => w.week >= 5);
  const overrideRate = (aiWeeks.reduce((a, w) => a + w.overrides, 0) / aiWeeks.reduce((a, w) => a + w.cases - w.info_requested, 0)) * 100;
  const lastOverrideRate = (last.overrides / (last.cases - last.info_requested)) * 100;
  const autoNow = (last.auto_approved / last.cases) * 100;
  const adoption = (last.reviewers_active / last.reviewers_total) * 100;

  const tiles = {
    review: { baseline: baseMin, now: last.avg_review_min, drop: (1 - last.avg_review_min / baseMin) * 100 },
    auto: { baseline: 0, now: autoNow },
    override: { now: lastOverrideRate, since: overrideRate },
    adoption: { active: last.reviewers_active, total: last.reviewers_total, pct: adoption },
    cases: { now: last.cases, first: weekly[0].cases },
  };

  const signals: { kind: "expand" | "risk" | "ok"; text: string }[] = [];
  if (autoNow >= 70 && lastOverrideRate <= 5)
    signals.push({ kind: "expand", text: `Prior auth is stable (${autoNow.toFixed(0)}% auto-resolved, ${lastOverrideRate.toFixed(1)}% overridden). Propose HCC retrospective review next: it reuses the same member resolution and data layer, so the incremental integration work is small.` });
  if (adoption < 90)
    signals.push({ kind: "risk", text: `${last.reviewers_total - last.reviewers_active} of ${last.reviewers_total} reviewers have not used the tool this week. Schedule an enablement session before the renewal conversation.` });
  const topCat = Object.entries(overrides.reduce<Record<string, number>>((m, o) => ((m[String(o.category)] = (m[String(o.category)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
  if (topCat) signals.push({ kind: "ok", text: `Most common override reason: "${topCat[0]}" (${topCat[1]} of ${overrides.length} sampled). Take it to the customer's clinical lead as a policy-wording fix, not a model fix.` });

  return { trend, tiles, signals, overrides, requests, milestones: MILESTONES, targets: { reviewMin: 4, auto: 92 } };
}

/* ---------- feedback to product request ---------- */
type Draft = { title: string; problem: string; evidence: string; proposal: string; severity: string; area: string };

const FEEDBACK_PROMPT = (raw: string) => `You turn messy customer feedback into one clear product request for an engineering team.
Reply with JSON only, no prose, no code fences:
{"title":"short imperative title, 8 words max","problem":"one sentence: what is going wrong for the user","evidence":"ONE short phrase copied EXACTLY from the feedback","proposal":"one sentence: the smallest change that would fix it","severity":"low|medium|high","area":"one of: decisioning, data integration, reviewer UI, reporting, policy content, other"}
If the feedback contains several issues, choose the most important one. Do not invent facts that are not in the feedback.

FEEDBACK:
"""${raw}"""`;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function fallbackDraft(raw: string): Draft {
  const first = raw.split(/(?<=[.!?])\s+/)[0]?.trim() ?? raw.trim();
  return { title: first.slice(0, 60), problem: first, evidence: first.slice(0, 120), proposal: "Review with the customer and size the change.", severity: "medium", area: "other" };
}

export async function submitFeedback(raw: string) {
  await ensure();
  const text = raw.trim().slice(0, 1500);
  let draft = fallbackDraft(text);
  let by = "template (model unavailable or answer failed verification)";
  const out = await draftText(FEEDBACK_PROMPT(text));
  if (out) {
    try {
      const j = JSON.parse(firstJsonObject(out)) as Draft;
      const ok = ["title", "problem", "evidence", "proposal", "severity", "area"].every((k) => typeof (j as Record<string, unknown>)[k] === "string");
      if (ok && ["low", "medium", "high"].includes(j.severity) && norm(text).includes(norm(j.evidence))) {
        draft = j;
        by = "gemma-4-26b-a4b-it (evidence quote verified)";
      }
    } catch {
      /* keep fallback */
    }
  }
  await q(
    `INSERT INTO feature_requests(raw, title, problem, evidence, proposal, severity, area, drafted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [text, draft.title, draft.problem, draft.evidence, draft.proposal, draft.severity, draft.area, by],
  );
  return getValue();
}

export async function clearRequests() {
  await ensure();
  await q(`DELETE FROM feature_requests`);
}
