import { NextResponse } from "next/server";
import { getValue } from "@/lib/value";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getValue());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
