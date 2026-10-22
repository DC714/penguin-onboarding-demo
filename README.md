# Payer onboarding demo: from messy data to prior-auth decisions (synthetic data)

An interview demo for a Forward Deployed Engineer role at Penguin Ai. It shows how a new payer customer would be onboarded and what the first 90 days look like.

**Live demo:** https://penguin-onboarding-demo.vercel.app

Everything is synthetic. "Northwind Health Plan" is a fictional payer, and all metrics in the Value review tab are illustrative. This is an unofficial demo, not affiliated with Penguin Ai's production systems, and it does not use any Penguin Ai code or data.

## What is in the app

| Tab | What it shows |
|---|---|
| **Onboarding plan** | Pick a customer profile (payer or provider, first use case, data source, deployment, 6 to 12 week target). Get a day-scaled timeline, integration checklist, risks with mitigations, and KPIs to baseline. An optional model-drafted executive kickoff summary falls back to a template. |
| **1 Sources** | A FHIR R4 bundle, HL7 v2 ADT^A08 messages, and a claims CSV, ingested into Postgres. |
| **2 Validate** | NPI check-digit (Luhn), ICD-10 format, CPT and diagnosis consistency, orphaned members, missing member IDs. "Apply directory fix" repairs provider NPIs and re-decides. |
| **3 Resolve** | Entity resolution across sources: nicknames, punctuation, missing IDs. Same name with a different DOB stays separate. Match scores and rationale are shown. |
| **4 Prior auth** | Policy `NHP-IMG-014` (lumbar MRI) has four criteria. A clean pass auto-approves, otherwise it goes to a human or back to the provider, with a per-criterion audit trail. Engine toggle: deterministic rules or an open-weight model. |
| **5 SQL** | Allow-listed queries against the Neon tables. |
| **6 Value review** | Month-three view over 12 synthetic weeks: baseline vs now, trend charts with milestones, reviewer overrides, expansion and renewal-risk signals, and customer feedback turned into a structured product request. |

## How the model step works
Gemma 4 (`gemma-4-26b-a4b-it`, open weights) via the Google AI Studio API is used in three places: reading clinical notes against two policy criteria, drafting the kickoff summary, and structuring customer feedback.

- The model only handles unstructured text. Claims history and NPI checks stay in plain code.
- Every judgment must include a quote that appears verbatim in the source text. Code rejects the whole answer otherwise.
- On any failure (HTTP error, bad JSON, unverifiable quote) the app falls back to the deterministic rules engine or a template, and says so in the audit trail.
- `thinkingLevel: "minimal"` cut latency from about 12 s to about 2 s per call with the same accuracy on the benchmark.
- `scripts/compare.mts` scores engines on 12 labeled notes (6 demo cases plus 6 hard ones such as negations and spelled-out numbers). Rules engine: 16 of 24 judgments. Gemma 26B: 22 of 24 in the last full run. The labels are the author's and the set is small, so treat it as a sanity check, not a benchmark.

## Stack
Next.js 16 (App Router) · Mantine 9 including `@mantine/charts` · Neon Postgres (`@neondatabase/serverless`) · TypeScript · Vercel. Brand tokens (Outfit, Public Sans, pink `#fe017d`, teal `#05526d`, cream `#f9f7f2`) come from penguinai.co/gwenos.

## Run locally
```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Environment variables:

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `GEMMA_API_KEY` | no | Google AI Studio key. Without it the model options are disabled and everything runs on the rules engine and templates. |
| `GEMMA_MODEL` | no | Override the model name |
| `GEMMA_THINKING` | no | Thinking level, default `minimal` |

Scripts (run with `node --env-file=.env.local node_modules/.bin/tsx <file>`):
- `scripts/smoke.ts` runs the whole pipeline headlessly against Neon.
- `scripts/compare.mts` compares the rules engine with the model on the labeled notes. Set `ENGINES=gemma` to choose which models run.

## Data model (Neon)
Pipeline tables are dropped and rebuilt on each ingest: `staging_records`, `issues`, `members`, `member_links`, `providers`, `claims`, `auth_requests`, `auth_decisions`, `pipeline_runs`. Value-review tables persist and seed themselves on first load: `weekly_metrics`, `reviewer_overrides`, `feature_requests`.

## Deploy to Vercel
Import the repo, set `DATABASE_URL` (and optionally `GEMMA_API_KEY`) as environment variables, and deploy. The free Neon database sleeps when idle, so open the app once before a demo. API routes allow up to 60 seconds for the model-backed steps.

## Limitations
- Synthetic data only. No PHI. The "provider directory" fix is a simulated lookup.
- The prior-auth engine covers one policy and one procedure. It illustrates the pattern; it is not a clinical tool.
- The model benchmark is small and self-labeled. Free-tier Gemma 4 on the API shows occasional transient 500 errors, which the app retries and then falls back from.
