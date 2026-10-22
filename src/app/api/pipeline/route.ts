import { NextResponse } from "next/server";
import { authorize, fixProviders, ingest, resolve, validate } from "@/lib/pipeline";

const STEPS = { ingest, validate, resolve, authorize, fix: fixProviders } as const;

export async function POST(req: Request) {
  const { step } = (await req.json()) as { step: keyof typeof STEPS };
  const run = STEPS[step];
  if (!run) return NextResponse.json({ error: "unknown step" }, { status: 400 });
  try {
    return NextResponse.json({ step, stats: await run() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
