import { NextResponse } from "next/server";
import { state } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await state());
}
