"use server";
import { signOut } from "@/features/auth/lib/auth";

export async function signOutAction(formData: FormData) {
  const redirectTo = formData.get("redirectTo")?.toString() || "/auth";
  await signOut({ redirectTo });
}
