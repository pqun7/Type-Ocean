"use server";

import prisma from "@/features/auth/lib/db";
import { auth, signOut } from "@/features/auth/lib/auth";

export async function signOutAction(formData: FormData) {
  const redirectTo = formData.get("redirectTo")?.toString() || "/auth";

  const session = await auth();
  if (session?.user?.id) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        pvpWsTokenVersion: { increment: 1 },
        pvpWsTokensValidAfter: new Date(),
      },
      select: { id: true },
    });
  }

  await signOut({ redirectTo });
}
