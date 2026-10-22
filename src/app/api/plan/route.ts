import { NextResponse } from "next/server";
import { draftText, PROVIDERS } from "@/lib/llm";
import { generatePlan, summaryPrompt, templateSummary, type PlanConfig } from "@/lib/plan";

export const maxDuration = 60;

export async function POST(req: Request) {
  const cfg = (await req.json()) as PlanConfig;
  const plan = generatePlan(cfg);
  const drafted = await draftText(summaryPrompt(cfg, plan));
  return NextResponse.json(
    drafted
      ? { summary: drafted.replace(/\*\*/g, ""), source: PROVIDERS.gemma.model }
      : { summary: templateSummary(cfg, plan), source: "template (model unavailable)" },
  );
}
