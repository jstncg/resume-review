import { NextResponse } from "next/server";
import { getConditionState, setCondition } from "@/lib/conditionStore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getConditionState());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const condition = (body as any)?.condition;
  if (typeof condition !== "string") {
    return NextResponse.json({ error: "Expected { condition: string }" }, { status: 400 });
  }

  return NextResponse.json(setCondition(condition));
}


