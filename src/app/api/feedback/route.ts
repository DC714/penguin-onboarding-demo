import { NextResponse } from "next/server";
import { clearRequests, submitFeedback } from "@/lib/value";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { text, clear } = (await req.json()) as { text?: string; clear?: boolean };
  try {
    if (clear) await clearRequests();
    if (!clear && (!text || text.trim().length < 10)) return NextResponse.json({ error: "Feedback is too short." }, { status: 400 });
    return NextResponse.json(clear ? { ok: true } : await submitFeedback(text!));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
