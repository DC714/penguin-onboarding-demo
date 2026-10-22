# Payer onboarding demo: prior auth on GwenOS (synthetic data)

An interview demo for a Forward Deployed Engineer role at Penguin Ai. It shows how a new payer customer would be onboarded:
messy source data in, validated and de-duplicated records in Postgres, then prior-authorization decisions with a per-criterion audit trail.

Everything is synthetic. "Northwind Health Plan" is fictional. This is an unofficial demo, not affiliated with Penguin Ai's production systems,
and the "AI worker" is a deterministic criteria engine that simulates where a model would sit.

## The flow
1. **Ingest**: a FHIR R4 bundle (Patient, Practitioner, ServiceRequest, DocumentReference), HL7 v2 ADT^A08 messages, and a claims CSV.
2. **Validate**: NPI Luhn check digit, ICD-10 format, CPT/diagnosis consistency, orphaned members, missing member IDs.
3. **Resolve**: entity resolution across sources (nicknames, punctuation, missing IDs). Same name with a different DOB is kept separate.
4. **Prior auth**: policy `NHP-IMG-014` (lumbar MRI) has four criteria. A clean pass auto-approves; anything else routes to a human or back to the provider.
   "Apply directory fix" repairs two provider NPIs and re-decides, turning 1 of 6 approvals into 3 of 6.
5. **SQL**: allow-listed queries against the Neon tables.

## Stack
Next.js 16 (App Router) · Mantine 9 · Neon Postgres (`@neondatabase/serverless`) · TypeScript. Brand tokens (Outfit, Public Sans, pink `#fe017d`,
teal `#05526d`, cream `#f9f7f2`) come from penguinai.co/gwenos.

## Run locally
```bash
npm install
echo "DATABASE_URL=postgresql://..." > .env.local   # a Neon connection string
npm run dev
```
`npx tsx scripts/smoke.ts` runs the whole pipeline headlessly (use `node --env-file=.env.local`).

## Deploy to Vercel
Import the repo, add `DATABASE_URL` as an environment variable (or use the Neon integration), deploy. Open the app once before a demo to wake the free Neon database.
