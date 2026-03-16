export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { clearAdminNotice, getAdminNotice } from "@/features/admin/server/admin-notices";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ notice: null }, { status: 200 });
  }

  const notice = await getAdminNotice(session.user.id);
  return NextResponse.json({ notice }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  await clearAdminNotice(session.user.id);
  return NextResponse.json({ success: true });
}
