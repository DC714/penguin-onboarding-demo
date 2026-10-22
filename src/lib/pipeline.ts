import { distance } from "fastest-levenshtein";
import { q, SCHEMA } from "@/lib/db";
import { isValidNpi } from "@/lib/npi";
import { CLAIMS_CSV, FHIR_BUNDLE, HL7_MESSAGES, NPI_DIRECTORY, POLICY } from "@/data/fixtures";

/* ---------- types ---------- */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Patient = { source: string; sourceId: string; first: string; last: string; dob: string; zip: string; memberId: string | null };
type Practitioner = { sourceId: string; name: string; specialty: string; npi: string | null };
type AuthReq = { authId: string; memberId: string; pracId: string; icd10: string; cpt: string; note: string };
type Claim = { claimId: string; memberId: string; npi: string; cpt: string; icd10: string; serviceDate: string };

export const normId = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : null);
const IMAGING_CPT = new Set(["72148", "72149", "72158", "72131", "72132", "72133", "72100", "72110", "72114"]);
const SPINE_ICD = /^M(4[0-9]|5[0-4])/;
const ICD_FORMAT = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?$/;

/* ---------- parsing ---------- */
function parseFhir(): { patients: Patient[]; pracs: Practitioner[]; reqs: AuthReq[] } {
  const res = (FHIR_BUNDLE.entry as Json[]).map((e) => e.resource as Json);
  const patients: Patient[] = res
    .filter((r) => r.resourceType === "Patient")
    .map((r) => ({
      source: "fhir",
      sourceId: r.id,
      first: r.name[0].given[0],
      last: r.name[0].family,
      dob: r.birthDate,
      zip: r.address?.[0]?.postalCode ?? "",
      memberId: r.identifier?.[0]?.value ?? null,
    }));
  const pracs: Practitioner[] = res
    .filter((r) => r.resourceType === "Practitioner")
    .map((r) => ({
      sourceId: r.id,
      name: `${r.name[0].given[0]} ${r.name[0].family}`,
      specialty: r.qualification?.[0]?.code?.text ?? "",
      npi: r.identifier?.[0]?.value ?? null,
    }));
  const docs = new Map(res.filter((r) => r.resourceType === "DocumentReference").map((r) => [r.id as string, r]));
  const reqs: AuthReq[] = res
    .filter((r) => r.resourceType === "ServiceRequest")
    .map((r) => {
      const doc = docs.get(r.supportingInfo?.[0]?.reference?.split("/")[1]);
      const b64 = doc?.content?.[0]?.attachment?.data;
      return {
        authId: r.id,
        memberId: r.subject.identifier.value,
        pracId: r.requester.reference.split("/")[1],
        icd10: r.reasonCode[0].coding[0].code,
        cpt: r.code.coding[0].code,
        note: b64 ? Buffer.from(b64, "base64").toString("utf8") : "",
      };
    });
  return { patients, pracs, reqs };
}

function parseHl7(): Patient[] {
  return HL7_MESSAGES.map((msg, i) => {
    const pid = msg.split("\r").find((s) => s.startsWith("PID"))!.split("|");
    const title = (x: string) => x.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
    const [last, first] = pid[5].split("^").map(title);
    const dob = pid[7];
    return {
      source: "hl7",
      sourceId: `MSG00${i + 1}`,
      first,
      last,
      dob: `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}`,
      zip: pid[11].split("^")[5],
      memberId: pid[3] || null,
    };
  });
}

function parseClaims(): Claim[] {
  const [, ...rows] = CLAIMS_CSV.split("\n");
  return rows.map((r) => {
    const [claimId, memberId, npi, cpt, icd10, serviceDate] = r.split(",");
    return { claimId, memberId, npi, cpt, icd10, serviceDate };
  });
}

/* ---------- steps ---------- */
async function record(step: string, stats: Json) {
  await q(
    `INSERT INTO pipeline_runs(step, stats) VALUES ($1,$2) ON CONFLICT (step) DO UPDATE SET ran_at = now(), stats = $2`,
    [step, JSON.stringify(stats)],
  );
}

export async function reset() {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
}

export async function ingest() {
  await reset();
  const fhir = parseFhir();
  const hl7 = parseHl7();
  const claims = parseClaims();
  const rows = [
    ...fhir.patients.map((p) => ({ source: "fhir", kind: "patient", payload: p })),
    ...hl7.map((p) => ({ source: "hl7", kind: "patient", payload: p })),
    ...fhir.pracs.map((p) => ({ source: "fhir", kind: "practitioner", payload: p })),
    ...fhir.reqs.map((p) => ({ source: "fhir", kind: "auth_request", payload: p })),
    ...claims.map((p) => ({ source: "csv", kind: "claim", payload: p })),
  ];
  await q(
    `INSERT INTO staging_records(source, kind, payload)
     SELECT source, kind, payload FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, payload jsonb)`,
    [JSON.stringify(rows)],
  );
  const stats = {
    "FHIR Patients": fhir.patients.length,
    "HL7 ADT messages": hl7.length,
    "FHIR Practitioners": fhir.pracs.length,
    "FHIR ServiceRequests": fhir.reqs.length,
    "Claims rows": claims.length,
  };
  await record("ingest", stats);
  return stats;
}

async function staged<T>(kind: string): Promise<T[]> {
  const rows = await q<{ payload: T }>(`SELECT payload FROM staging_records WHERE kind = $1 ORDER BY id`, [kind]);
  return rows.map((r) => r.payload);
}

export async function validate() {
  await q(`DELETE FROM issues`);
  const patients = await staged<Patient>("patient");
  const pracs = await staged<Practitioner>("practitioner");
  const claims = await staged<Claim>("claim");
  const known = new Set(patients.map((p) => normId(p.memberId)).filter(Boolean));
  const issues: { severity: string; entity: string; entity_ref: string; rule: string; message: string }[] = [];
  const add = (severity: string, entity: string, ref: string, rule: string, message: string) =>
    issues.push({ severity, entity, entity_ref: ref, rule, message });

  for (const p of patients) {
    const label = `${p.source}:${p.sourceId} ${p.first} ${p.last}`;
    if (!p.memberId) add("warning", "member", label, "MEMBER_ID_MISSING", "No member ID on record; must be matched by demographics.");
    else if (p.memberId !== normId(p.memberId)) add("info", "member", label, "MEMBER_ID_FORMAT", `Member ID "${p.memberId}" normalised to ${normId(p.memberId)}.`);
  }
  for (const p of pracs) {
    if (!p.npi) add("error", "provider", p.name, "NPI_MISSING", "No NPI on the practitioner record. Prior-auth requests from this provider cannot be automated.");
    else if (!isValidNpi(p.npi)) add("error", "provider", p.name, "NPI_CHECKSUM", `NPI ${p.npi} fails the Luhn check digit (likely a transposition).`);
  }
  for (const c of claims) {
    if (!known.has(normId(c.memberId))) add("error", "claim", c.claimId, "CLAIM_ORPHAN_MEMBER", `Member ${c.memberId} does not exist in the eligibility feed.`);
    if (!ICD_FORMAT.test(c.icd10)) add("error", "claim", c.claimId, "ICD10_FORMAT", `"${c.icd10}" is not a valid ICD-10-CM code format.`);
    else if (c.cpt === "72148" && !SPINE_ICD.test(c.icd10)) add("warning", "claim", c.claimId, "CPT_ICD_MISMATCH", `CPT 72148 (lumbar MRI) billed with ${c.icd10}, which is not a spine diagnosis.`);
  }
  await q(
    `INSERT INTO issues(severity, entity, entity_ref, rule, message)
     SELECT severity, entity, entity_ref, rule, message FROM jsonb_to_recordset($1::jsonb) AS x(severity text, entity text, entity_ref text, rule text, message text)`,
    [JSON.stringify(issues)],
  );
  const stats = {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
  await record("validate", stats);
  return stats;
}

const NICKNAMES: Record<string, string> = { jim: "james", jimmy: "james", bob: "robert", bobby: "robert", liz: "elizabeth", maria: "maria" };
const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const canonFirst = (s: string) => NICKNAMES[clean(s)] ?? clean(s);

function matchScore(a: Patient, b: Patient): { score: number; rationale: string } {
  if (a.dob !== b.dob) return { score: 0, rationale: "Date of birth differs: kept separate even if names look alike." };
  const lastSim = 1 - distance(clean(a.last), clean(b.last)) / Math.max(clean(a.last).length, clean(b.last).length);
  const fa = canonFirst(a.first), fb = canonFirst(b.first);
  const firstOk = fa === fb || fa[0] === fb[0] || distance(fa, fb) <= 1;
  const zip = a.zip && a.zip === b.zip;
  const score = 0.45 + 0.3 * lastSim + (firstOk ? 0.15 : 0) + (zip ? 0.1 : 0);
  const rationale = `DOB match; last-name similarity ${(lastSim * 100).toFixed(0)}%; first name ${firstOk ? "compatible" : "different"}; ZIP ${zip ? "match" : "differs"}.`;
  return { score: Number(score.toFixed(2)), rationale };
}

export async function resolve() {
  for (const t of ["member_links", "members", "providers", "claims", "auth_requests"]) await q(`DELETE FROM ${t}`);
  const patients = await staged<Patient>("patient");
  const pracs = await staged<Practitioner>("practitioner");
  const claims = await staged<Claim>("claim");
  const reqs = await staged<AuthReq>("auth_request");

  // cluster patients: join a cluster when score >= 0.85 against its first record
  const clusters: { head: Patient; members: { p: Patient; score: number; rationale: string }[] }[] = [];
  for (const p of patients) {
    let placed = false;
    for (const c of clusters) {
      const m = matchScore(c.head, p);
      if (m.score >= 0.85) {
        c.members.push({ p, ...m });
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ head: p, members: [{ p, score: 1, rationale: "Anchor record." }] });
  }
  const golden = clusters.map((c, i) => {
    const withId = c.members.find((m) => normId(m.p.memberId))?.p;
    const h = c.head;
    return {
      member_key: `MBR-${String(i + 1).padStart(4, "0")}`,
      member_id: normId(withId?.memberId) ?? null,
      full_name: `${h.first} ${h.last}`,
      dob: h.dob,
      zip: h.zip,
      source_count: c.members.length,
      links: c.members.map((m) => ({ source: m.p.source, source_id: m.p.sourceId, score: m.score, rationale: m.rationale })),
    };
  });
  await q(
    `INSERT INTO members(member_key, member_id, full_name, dob, zip, source_count)
     SELECT member_key, member_id, full_name, dob::date, zip, source_count FROM jsonb_to_recordset($1::jsonb) AS x(member_key text, member_id text, full_name text, dob text, zip text, source_count int)`,
    [JSON.stringify(golden.map(({ links: _l, ...g }) => g))], // eslint-disable-line @typescript-eslint/no-unused-vars
  );
  await q(
    `INSERT INTO member_links(source, source_id, member_key, score, rationale)
     SELECT source, source_id, member_key, score, rationale FROM jsonb_to_recordset($1::jsonb) AS x(source text, source_id text, member_key text, score numeric, rationale text)`,
    [JSON.stringify(golden.flatMap((g) => g.links.map((l) => ({ ...l, member_key: g.member_key }))))],
  );
  const keyById = new Map(golden.filter((g) => g.member_id).map((g) => [g.member_id!, g.member_key]));

  const provRows = pracs.map((p) => ({
    npi: p.npi ?? "",
    name: `Dr. ${p.name}`,
    specialty: p.specialty,
    npi_status: !p.npi ? "missing" : isValidNpi(p.npi) ? "valid" : "invalid",
  }));
  await q(
    `INSERT INTO providers(npi, name, specialty, npi_status)
     SELECT npi, name, specialty, npi_status FROM jsonb_to_recordset($1::jsonb) AS x(npi text, name text, specialty text, npi_status text)`,
    [JSON.stringify(provRows)],
  );
  const nameByPrac = new Map(pracs.map((p) => [p.sourceId, `Dr. ${p.name}`]));
  const npiByPrac = new Map(pracs.map((p) => [p.sourceId, p.npi ?? ""]));

  await q(
    `INSERT INTO claims(claim_id, member_id, member_key, npi, cpt, icd10, service_date)
     SELECT claim_id, member_id, member_key, npi, cpt, icd10, service_date::date FROM jsonb_to_recordset($1::jsonb) AS x(claim_id text, member_id text, member_key text, npi text, cpt text, icd10 text, service_date text)`,
    [JSON.stringify(claims.map((c) => ({ claim_id: c.claimId, member_id: normId(c.memberId), member_key: keyById.get(normId(c.memberId)!) ?? null, npi: c.npi, cpt: c.cpt, icd10: c.icd10, service_date: c.serviceDate })))],
  );
  await q(
    `INSERT INTO auth_requests(auth_id, member_key, npi, provider_name, cpt, icd10, note)
     SELECT auth_id, member_key, npi, provider_name, cpt, icd10, note FROM jsonb_to_recordset($1::jsonb) AS x(auth_id text, member_key text, npi text, provider_name text, cpt text, icd10 text, note text)`,
    [JSON.stringify(reqs.map((r) => ({ auth_id: r.authId, member_key: keyById.get(normId(r.memberId)!) ?? null, npi: npiByPrac.get(r.pracId), provider_name: nameByPrac.get(r.pracId), cpt: r.cpt, icd10: r.icd10, note: r.note })))],
  );
  const stats = {
    "Source patient records": patients.length,
    "Golden members": golden.length,
    "Duplicates merged": patients.length - golden.length,
    Providers: pracs.length,
    Claims: claims.length,
    "Auth requests": reqs.length,
  };
  await record("resolve", stats);
  return stats;
}

/** Simulated NPPES-style directory enrichment for providers with bad NPIs. */
export async function fixProviders() {
  const bad = await q<{ name: string; npi: string }>(`SELECT name, npi FROM providers WHERE npi_status <> 'valid'`);
  let fixed = 0;
  for (const p of bad) {
    const fix = NPI_DIRECTORY[p.name.replace(/^Dr\. /, "")];
    if (!fix) continue;
    await q(`UPDATE providers SET npi = $1, npi_status = 'valid' WHERE name = $2`, [fix, p.name]);
    await q(`UPDATE auth_requests SET npi = $1 WHERE provider_name = $2`, [fix, p.name]);
    await q(`UPDATE issues SET resolved = true WHERE entity = 'provider' AND entity_ref = $1`, [p.name.replace(/^Dr\. /, "")]);
    fixed++;
  }
  await record("fix", { "Providers corrected": fixed });
  return { "Providers corrected": fixed };
}

/* ---------- prior-auth criteria engine ---------- */
type Status = "met" | "not_met" | "ambiguous" | "missing";
type Criterion = { id: string; label: string; status: Status; evidence: string };

const sentences = (t: string) => t.split(/(?<=\.)\s+/).filter(Boolean);
const THERAPY = /physical therapy|\bPT\b|NSAID|ibuprofen|conservative|medication/i;
const NEURO = /radiculopathy|radicular|weakness|numbness|strength\s+[0-4]\/5|foot drop|(diminished|decreased|absent)\s+[\w\s]*reflex/i;

function evalC1(note: string): Criterion {
  const base = { id: "C1", label: POLICY.criteria[0].label };
  if (!note) return { ...base, status: "missing", evidence: "No clinical note attached." };
  const hits = sentences(note).filter((s) => THERAPY.test(s));
  if (!hits.length) return { ...base, status: "not_met", evidence: "No conservative therapy mentioned in the note." };
  const quote = hits.join(" ");
  if (/not started|no (pt|physical therapy)|has not/i.test(quote)) return { ...base, status: "not_met", evidence: `"${quote}"` };
  const weeks = [...quote.matchAll(/(\d+)\s*weeks?/gi)].map((m) => Number(m[1]));
  if (!weeks.length) return { ...base, status: "ambiguous", evidence: `"${quote}" — duration not stated, so 6 weeks cannot be confirmed.` };
  return { ...base, status: Math.max(...weeks) >= 6 ? "met" : "not_met", evidence: `"${quote}"` };
}

function evalC2(note: string): Criterion {
  const base = { id: "C2", label: POLICY.criteria[1].label };
  if (!note) return { ...base, status: "missing", evidence: "No clinical note attached." };
  const hit = sentences(note).find((s) => NEURO.test(s));
  return hit
    ? { ...base, status: "met", evidence: `"${hit}"` }
    : { ...base, status: "not_met", evidence: "No objective neurological deficit documented. Note states a normal neuro exam." };
}

export async function authorize() {
  await q(`DELETE FROM auth_decisions`);
  const reqs = await q<Json>(`SELECT * FROM auth_requests ORDER BY auth_id`);
  const out: Json[] = [];
  for (const r of reqs) {
    const c3rows = r.member_key
      ? await q<Json>(
          `SELECT claim_id, cpt, service_date FROM claims WHERE member_key = $1 AND cpt = ANY($2) AND service_date > now() - interval '12 months'`,
          [r.member_key, [...IMAGING_CPT]],
        )
      : [];
    const c3: Criterion = {
      id: "C3",
      label: POLICY.criteria[2].label,
      status: c3rows.length ? "not_met" : "met",
      evidence: c3rows.length
        ? `Claim ${c3rows[0].claim_id} (CPT ${c3rows[0].cpt}) on ${String(c3rows[0].service_date).slice(0, 10)}. Query against Neon \`claims\` table.`
        : "No lumbar imaging claims in the last 12 months (Neon `claims` query).",
    };
    const npiStatus = r.npi ? (isValidNpi(r.npi) ? "met" : "not_met") : "missing";
    const c4: Criterion = {
      id: "C4",
      label: POLICY.criteria[3].label,
      status: npiStatus,
      evidence: npiStatus === "met" ? `${r.provider_name}, NPI ${r.npi} passes check digit.` : `${r.provider_name}: NPI ${r.npi || "(blank)"} is ${r.npi ? "invalid" : "missing"}. Fix provider onboarding data first.`,
    };
    const criteria = [evalC1(r.note), evalC2(r.note), c3, c4];
    const anyMissing = criteria.some((c) => c.status === "missing" || (c.id === "C4" && c.status !== "met"));
    const allMet = criteria.every((c) => c.status === "met");
    const outcome = allMet ? "AUTO_APPROVE" : anyMissing ? "REQUEST_INFO" : "HUMAN_REVIEW";
    const failing = criteria.filter((c) => c.status !== "met").map((c) => c.id).join(", ");
    const summary =
      outcome === "AUTO_APPROVE"
        ? "All four policy criteria met with cited evidence. Approved without human touch."
        : outcome === "REQUEST_INFO"
          ? `Cannot decide: required data missing or invalid (${failing}). Returned to provider/onboarding queue.`
          : `Criteria not clearly met (${failing}). Routed to a clinical reviewer with the evidence below. Only humans can deny.`;
    const audit = {
      policy: `${POLICY.id} · ${POLICY.title}`,
      criteria,
      steps: [
        { actor: "Intake", detail: `Request ${r.auth_id} received for CPT ${r.cpt} / ${r.icd10}.` },
        { actor: "Data layer", detail: r.member_key ? `Resolved to golden member ${r.member_key}.` : "Member could not be resolved." },
        { actor: "Rules engine", detail: `Evaluated ${criteria.length} criteria from ${POLICY.id}.` },
        { actor: outcome === "HUMAN_REVIEW" ? "Reviewer queue" : "Decision", detail: summary },
      ],
    };
    out.push({ auth_id: r.auth_id, outcome, summary, audit });
  }
  await q(
    `INSERT INTO auth_decisions(auth_id, outcome, summary, audit)
     SELECT auth_id, outcome, summary, audit FROM jsonb_to_recordset($1::jsonb) AS x(auth_id text, outcome text, summary text, audit jsonb)`,
    [JSON.stringify(out)],
  );
  const stats = {
    Approved: out.filter((o) => o.outcome === "AUTO_APPROVE").length,
    "Human review": out.filter((o) => o.outcome === "HUMAN_REVIEW").length,
    "Info requested": out.filter((o) => o.outcome === "REQUEST_INFO").length,
  };
  await record("authorize", stats);
  return stats;
}

/* ---------- read model ---------- */
export const CANNED_QUERIES: Record<string, { label: string; sql: string }> = {
  members: { label: "Golden members and how many source records each merged", sql: "SELECT member_key, member_id, full_name, dob, source_count FROM members ORDER BY member_key" },
  links: { label: "Why each record was linked (match scores)", sql: "SELECT m.full_name, l.source, l.source_id, l.score, l.rationale FROM member_links l JOIN members m USING (member_key) ORDER BY m.member_key, l.score DESC" },
  imaging: { label: "Lumbar imaging in the last 12 months, by member", sql: "SELECT m.full_name, c.claim_id, c.cpt, c.service_date FROM claims c JOIN members m USING (member_key) WHERE c.cpt IN ('72148','72149','72158') AND c.service_date > now() - interval '12 months'" },
  orphans: { label: "Claims that point at no known member", sql: "SELECT claim_id, member_id, cpt, icd10 FROM claims WHERE member_key IS NULL" },
  outcomes: { label: "Prior-auth outcomes", sql: "SELECT outcome, count(*)::int AS cases FROM auth_decisions GROUP BY outcome ORDER BY cases DESC" },
};

export async function state() {
  const [runs, issues, members, links, providers, requests, decisions] = await Promise.all([
    q(`SELECT step, ran_at, stats FROM pipeline_runs`),
    q(`SELECT * FROM issues ORDER BY id`),
    q(`SELECT member_key, member_id, full_name, dob::text, zip, source_count FROM members ORDER BY member_key`),
    q(`SELECT l.*, m.full_name FROM member_links l JOIN members m USING (member_key) ORDER BY l.member_key, l.score DESC`),
    q(`SELECT * FROM providers ORDER BY name`),
    q(`SELECT a.auth_id, a.cpt, a.icd10, a.provider_name, a.note, m.full_name FROM auth_requests a LEFT JOIN members m USING (member_key) ORDER BY a.auth_id`),
    q(`SELECT auth_id, outcome, summary, audit FROM auth_decisions ORDER BY auth_id`),
  ]).catch(() => [[], [], [], [], [], [], []] as Json[][]);
  const entries = FHIR_BUNDLE.entry as Json[];
  const pick = (type: string, id: string) => entries.find((e) => e.resource.resourceType === type && e.resource.id === id)?.resource;
  const sources = {
    fhir: JSON.stringify([pick("Patient", "pat-1"), pick("Practitioner", "prac-3"), pick("ServiceRequest", "AUTH-1001")], null, 2),
    hl7: HL7_MESSAGES.map((m) => m.replace(/\r/g, "\n")).join("\n\n"),
    csv: CLAIMS_CSV,
  };
  return { runs, issues, members, links, providers, requests, decisions, policy: POLICY, sources };
}
