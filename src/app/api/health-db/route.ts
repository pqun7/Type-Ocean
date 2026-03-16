import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

export async function GET() {
  try {
    await db.execute(sql`select 1`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "database_unreachable";

    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
