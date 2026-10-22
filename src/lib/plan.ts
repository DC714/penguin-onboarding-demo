/** Deterministic onboarding-plan generator. Pure functions, safe to run in the browser. */
export type PlanConfig = {
  org: "payer" | "provider";
  useCase: "um" | "hcc" | "rcm";
  source: "fhir" | "claims" | "hl7" | "snowflake";
  deploy: "aws" | "snowflake";
  weeks: number;
};

export const DEFAULT_CONFIG: PlanConfig = { org: "payer", useCase: "um", source: "fhir", deploy: "aws", weeks: 8 };

export const LABELS = {
  org: { payer: "Health plan (payer)", provider: "Provider group" },
  useCase: { um: "Prior auth / utilization management", hcc: "HCC coding and risk adjustment", rcm: "Revenue cycle: denials" },
  source: { fhir: "EHR via FHIR API", claims: "Claims flat files", hl7: "HL7 v2 feeds", snowflake: "Snowflake data share" },
  deploy: { aws: "Customer's AWS account", snowflake: "Snowflake Native App" },
} as const;

export type Phase = { name: string; start: number; weeks: number; owner: string; outcome: string };
export type Kpi = { metric: string; baseline: string; target: string };
export type Plan = { phases: Phase[]; checklist: string[]; risks: { risk: string; mitigation: string }[]; kpis: Kpi[]; policyWork: string };

const PHASES = [
  { name: "Discovery and KPI baseline", w: 3, owner: "FDE + customer sponsor", outcome: "Signed-off success metrics and a measured baseline" },
  { name: "Data connect and validate", w: 5, owner: "FDE + customer IT", outcome: "Clean, de-duplicated member, provider and claims data" },
  { name: "Policy load and configuration", w: 4, owner: "FDE + clinical lead", outcome: "Policies mapped to checkable criteria" },
  { name: "Test run", w: 4, owner: "FDE + reviewers", outcome: "Decisions compared with human reviewers, gaps closed" },
  { name: "Go-live and enablement", w: 2, owner: "FDE + operations", outcome: "Users trained, workflow switched on" },
  { name: "Hypercare and value review", w: 2, owner: "FDE + sponsor", outcome: "Measured results and the next use case" },
];

/** Every phase gets one week; the rest are split by weight (largest remainder, ties go to later phases). */
function allocate(total: number): number[] {
  const n = PHASES.length;
  const extra = Math.max(0, total - n);
  const sum = PHASES.reduce((a, p) => a + p.w, 0);
  const raw = PHASES.map((p) => (p.w / sum) * extra);
  const out = raw.map((r) => 1 + Math.floor(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || b.i - a.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++;
  return out;
}

const CHECKLIST: Record<PlanConfig["source"], string[]> = {
  fhir: ["Register an OAuth/SMART client with the EHR", "Confirm Patient, Coverage, Practitioner, ServiceRequest and DocumentReference access", "Validate NPIs and code systems (ICD-10-CM, CPT)", "Agree bulk export vs per-request access"],
  claims: ["Agree file layout and delivery cadence", "Build the member and provider ID crosswalk", "Reconcile claim counts against the source system", "Define handling for late-arriving claims"],
  hl7: ["Open an ADT feed into a staging interface engine", "Map PID segments and normalise member IDs", "Handle A08 updates and A40 merges", "Replay a week of history before go-live"],
  snowflake: ["Agree the data share and secure views", "Grant the Native App only the schemas it needs", "Review row-level security with the data owner", "Set up schema-drift monitoring"],
};

const POLICY: Record<PlanConfig["useCase"], string> = {
  um: "Load the highest-volume medical policies first (for example advanced imaging) and map each to checkable criteria.",
  hcc: "Load the active HCC model versions and agree the evidence standard for audit readiness.",
  rcm: "Load payer-specific denial rules and agree which pre-submission edits to turn on first.",
};

// Targets are Penguin Ai's own published figures: validate them against the customer's baseline, do not promise them.
const KPIS: Record<PlanConfig["useCase"], Kpi[]> = {
  um: [
    { metric: "Review time per case", baseline: "Measure in week 1 (published example: 30 min)", target: "Published figure: about 4 min" },
    { metric: "Cases resolved without human touch", baseline: "Measure in week 1", target: "Published figure: up to 92%" },
    { metric: "Reviewer overrides of AI decisions", baseline: "n/a", target: "Track weekly; below an agreed threshold by go-live" },
  ],
  hcc: [
    { metric: "Coding accuracy vs audited sample", baseline: "Measure on a 200-chart sample", target: "Published figure: about 96%" },
    { metric: "Charts reviewed per coder per day", baseline: "Measure in week 1", target: "Agree with sponsor" },
    { metric: "Audit-ready evidence per code", baseline: "Measure in week 1", target: "100% with cited evidence" },
  ],
  rcm: [
    { metric: "Denial rate on reviewed submissions", baseline: "Measure last 90 days", target: "Published figure: 56% fewer denials" },
    { metric: "Days in accounts receivable", baseline: "Measure in week 1", target: "Agree with sponsor" },
    { metric: "Rework touches per claim", baseline: "Measure in week 1", target: "Agree with sponsor" },
  ],
};

export function generatePlan(cfg: PlanConfig): Plan {
  const alloc = allocate(cfg.weeks);
  let start = 1;
  const phases: Phase[] = PHASES.map((p, i) => {
    const ph = { name: p.name, start, weeks: alloc[i], owner: p.owner, outcome: p.outcome };
    start += alloc[i];
    return ph;
  });

  const risks: Plan["risks"] = [];
  if (cfg.deploy === "aws") risks.push({ risk: "Security review is the long pole in a customer-account deployment", mitigation: "Send architecture and SOC evidence in week 1, in parallel with discovery" });
  else risks.push({ risk: "Native App install needs approval from the customer's Snowflake admin", mitigation: "Name the approver in discovery and book the install window early" });
  if (cfg.source === "hl7") risks.push({ risk: "Merge messages (A40) create duplicate members", mitigation: "Run entity resolution before any decision logic, as in the live demo" });
  if (cfg.source === "claims") risks.push({ risk: "Batch claims lag real-time eligibility", mitigation: "State the data latency up front and design the workflow around it" });
  if (cfg.source === "fhir") risks.push({ risk: "Provider records with missing or invalid NPIs block automation", mitigation: "Validate NPIs on day one and enrich from a provider directory" });
  if (cfg.source === "snowflake") risks.push({ risk: "Schema drift in the shared tables", mitigation: "Contract tests on the shared views, alert on change" });
  risks.push({ risk: "Clinical reviewer availability for policy sign-off", mitigation: "Book two review sessions per week into the plan now" });
  if (cfg.weeks < 8) risks.push({ risk: `Compressed ${cfg.weeks}-week timeline leaves a ${phases[3].weeks}-week test run`, mitigation: "Limit launch scope to the top policies and expand after go-live" });
  if (cfg.weeks > 10) risks.push({ risk: "Longer timelines lose sponsor attention", mitigation: "Hold a value checkpoint at the midpoint" });

  return { phases, checklist: CHECKLIST[cfg.source], risks, kpis: KPIS[cfg.useCase], policyWork: POLICY[cfg.useCase] };
}

/** Prompt for the optional model-drafted kickoff summary. */
export function summaryPrompt(cfg: PlanConfig, plan: Plan): string {
  return `Write a kickoff summary for an executive sponsor, 110 words maximum, plain prose with no bullet points, no headings, no markdown.
Customer: ${LABELS.org[cfg.org]}. First use case: ${LABELS.useCase[cfg.useCase]}. Data source: ${LABELS.source[cfg.source]}. Deployment: ${LABELS.deploy[cfg.deploy]}. Timeline: ${cfg.weeks} weeks.
Phases: ${plan.phases.map((p) => `${p.name} (weeks ${p.start}-${p.start + p.weeks - 1})`).join("; ")}.
Top risk: ${plan.risks[0].risk}. Success metrics: ${plan.kpis.map((k) => k.metric).join("; ")}.
State what happens first, what the sponsor must provide, and when value is measured. Do not invent numbers.`;
}

export function templateSummary(cfg: PlanConfig, plan: Plan): string {
  return `We will bring ${LABELS.useCase[cfg.useCase].toLowerCase()} live for your ${LABELS.org[cfg.org].toLowerCase()} in ${cfg.weeks} weeks, connecting ${LABELS.source[cfg.source].toLowerCase()} and deploying in ${LABELS.deploy[cfg.deploy].toLowerCase()}. The first ${plan.phases[0].weeks} weeks agree and baseline the success metrics, then we connect and validate your data before any decision runs. We need a named sponsor, an IT contact, and a clinical reviewer for policy sign-off. Value is measured against the baseline at go-live and again in the final phase.`;
}
