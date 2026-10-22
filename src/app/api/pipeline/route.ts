import { NextResponse } from "next/server";
import { authorize, type Engine, fixProviders, ingest, resolve, validate } from "@/lib/pipeline";

const STEPS = { ingest, validate, resolve, authorize: (e?: Engine) => authorize(e), fix: fixProviders } as const;

export async function POST(req: Request) {
  const { step, engine } = (await req.json()) as { step: keyof typeof STEPS; engine?: Engine };
  const run = STEPS[step];
  if (!run) return NextResponse.json({ error: "unknown step" }, { status: 400 });
  try {
    return NextResponse.json({ step, stats: await (run as (e?: Engine) => Promise<unknown>)(engine) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
