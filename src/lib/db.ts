import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = neon(url);

/** Parameterised query helper. Returns rows as plain objects. */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query(text, params)) as T[];
}

export const SCHEMA = `
DROP TABLE IF EXISTS auth_decisions, auth_requests, claims, providers, member_links, members, issues, staging_records, pipeline_runs CASCADE;
CREATE TABLE pipeline_runs (step text PRIMARY KEY, ran_at timestamptz DEFAULT now(), stats jsonb);
CREATE TABLE staging_records (id serial PRIMARY KEY, source text, kind text, payload jsonb);
CREATE TABLE issues (id serial PRIMARY KEY, severity text, entity text, entity_ref text, rule text, message text, resolved boolean DEFAULT false);
CREATE TABLE members (member_key text PRIMARY KEY, member_id text, full_name text, dob date, zip text, source_count int);
CREATE TABLE member_links (source text, source_id text, member_key text, score numeric, rationale text);
CREATE TABLE providers (npi text, name text, specialty text, npi_status text);
CREATE TABLE claims (claim_id text PRIMARY KEY, member_id text, member_key text, npi text, cpt text, icd10 text, service_date date);
CREATE TABLE auth_requests (auth_id text PRIMARY KEY, member_key text, npi text, provider_name text, cpt text, icd10 text, note text);
CREATE TABLE auth_decisions (auth_id text PRIMARY KEY, outcome text, summary text, audit jsonb, decided_at timestamptz DEFAULT now());
`;
