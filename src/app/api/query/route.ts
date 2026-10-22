import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { CANNED_QUERIES } from "@/lib/pipeline";

// Only allow-listed queries run: the demo is public-facing, so no arbitrary SQL.
export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  const query = CANNED_QUERIES[id];
  if (!query) return NextResponse.json({ error: "unknown query" }, { status: 400 });
  try {
    return NextResponse.json({ label: query.label, sql: query.sql, rows: await q(query.sql) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
export async function GET() {
  return NextResponse.json(Object.entries(CANNED_QUERIES).map(([id, v]) => ({ id, label: v.label })));
}
