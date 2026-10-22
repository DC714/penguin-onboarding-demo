import { authorize, fixProviders, ingest, resolve, validate, state } from "../src/lib/pipeline";

type Row = Record<string, unknown>;

async function main() {
  console.log("ingest", await ingest());
  console.log("validate", await validate());
  console.log("resolve", await resolve());
  console.log("authorize (before fix)", await authorize());
  const s1 = await state();
  console.log(s1.decisions.map((d: Row) => `${d.auth_id} ${d.outcome}`).join("\n"));
  console.log("links", s1.links.map((l: Row) => `${l.full_name} ${l.source}:${l.source_id} ${l.score}`).join("\n"));
  console.log("fix", await fixProviders());
  console.log("authorize (after fix)", await authorize());
  console.log((await state()).decisions.map((d: Row) => `${d.auth_id} ${d.outcome}`).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
