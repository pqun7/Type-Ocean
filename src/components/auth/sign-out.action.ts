"use server";

import { db } from "@/db";
import { auth, signOut } from "@/features/auth/lib/auth";
import { sql } from "drizzle-orm";

export async function signOutAction(formData: FormData) {
  const redirectTo = formData.get("redirectTo")?.toString() || "/auth";

  const session = await auth();
  if (session?.user?.id) {
    await db.execute(sql`
      UPDATE "User"
      SET "pvpWsTokenVersion" = "pvpWsTokenVersion" + 1,
          "pvpWsTokensValidAfter" = NOW()
      WHERE "id" = ${session.user.id}
    `);
  }

  await signOut({ redirectTo });
}
