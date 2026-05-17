import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import PvpRoomLobbyClient from "@/components/pvp/PvpRoomLobbyClient";
import { auth } from "@/features/auth/lib/auth";
import { db } from "@/db";
import { pvpRooms } from "@/db/schema";
import { sanitizeRoomCode } from "@/lib/sanitize";
import { isDatabaseTemporarilyUnavailableError } from "@/lib/db-error-utils";

// Room codes are 4–10 uppercase alphanumeric characters (matches sanitizeRoomCode output).
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = sanitizeRoomCode(rawCode);

  // Reject malformed codes before hitting the database.
  if (!ROOM_CODE_PATTERN.test(code)) {
    redirect("/pvp/room?error=invalid_code");
  }

  // Require authentication.
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth?form=login&next=${encodeURIComponent(`/pvp/room/${code}`)}`);
  }

  // Verify the room exists and is joinable.
  try {
    const rows = await db
      .select({ status: pvpRooms.status, expiresAt: pvpRooms.expiresAt })
      .from(pvpRooms)
      .where(eq(pvpRooms.code, code))
      .limit(1);

    const room = rows[0] ?? null;

    if (!room) {
      redirect("/pvp/room?error=not_found");
    }
    if (room.expiresAt && room.expiresAt < new Date()) {
      redirect("/pvp/room?error=expired");
    }
    if (room.status !== "OPEN") {
      redirect("/pvp/room?error=room_closed");
    }
  } catch (error) {
    if (!isDatabaseTemporarilyUnavailableError(error)) {
      throw error;
    }
    // On transient DB errors let the client connect and let the gateway handle it.
  }

  return <PvpRoomLobbyClient code={code} />;
}
