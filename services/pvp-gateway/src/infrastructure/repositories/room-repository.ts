import { asc, eq, isNull } from "drizzle-orm";
import { pvpRooms, pvpRoomMembers } from "../../../../../src/db/schema";
import { sanitizeAvatarUrl, sanitizeDisplayName } from "../../../../../src/lib/sanitize";
import { type GatewayDb } from "../../gateway-db";
import { nextRoomExpiryDate } from "../../shared/config";
import { selectNextRoomHost } from "../../rooms/lifecycle";

export type RoomStatePayload = {
  roomId: string;
  room: {
    code: string;
    status: string;
    visibility: string;
    minPlayers: number;
    maxPlayers: number;
    hostUserId: string | null;
    autoStartAt: string | null;
    expiresAt: string | null;
    members: Array<{
      userId: string;
      username: string;
      avatar: string | null;
      slot: number;
      ready: boolean;
      joinedAt: Date;
      leftAt: Date | null;
    }>;
  };
};

export class RoomRepository {
  constructor(private readonly db: GatewayDb) {}

  async touchExpiry(roomId: string): Promise<void> {
    await this.db
      .update(pvpRooms)
      .set({ expiresAt: nextRoomExpiryDate(), updatedAt: new Date() })
      .where(eq(pvpRooms.id, roomId));
  }

  async transferHostIfNeeded(roomId: string): Promise<string | null> {
    const room = await this.db.query.pvpRooms.findFirst({
      columns: {
        id: true,
        hostUserId: true,
      },
      where: eq(pvpRooms.id, roomId),
      with: {
        members: {
          columns: {
            userId: true,
            joinedAt: true,
            readyAt: true,
            leftAt: true,
          },
          orderBy: asc(pvpRoomMembers.joinedAt),
        },
      },
    });

    if (!room) return null;

    const nextHostUserId = selectNextRoomHost(room.members, room.hostUserId);
    if (!nextHostUserId || nextHostUserId === room.hostUserId) return nextHostUserId;

    await this.db
      .update(pvpRooms)
      .set({ hostUserId: nextHostUserId, updatedAt: new Date() })
      .where(eq(pvpRooms.id, roomId));

    return nextHostUserId;
  }

  async loadStatePayload(roomCode: string): Promise<RoomStatePayload | null> {
    const room = await this.db.query.pvpRooms.findFirst({
      columns: {
        id: true,
        code: true,
        status: true,
        visibility: true,
        minPlayers: true,
        maxPlayers: true,
        hostUserId: true,
        autoStartAt: true,
        expiresAt: true,
      },
      where: eq(pvpRooms.code, roomCode),
      with: {
        members: {
          columns: {
            userId: true,
            colorSlot: true,
            readyAt: true,
            joinedAt: true,
            leftAt: true,
          },
          where: isNull(pvpRoomMembers.leftAt),
          orderBy: asc(pvpRoomMembers.joinedAt),
          with: {
            user: {
              columns: {
                username: true,
              },
              with: {
                profile: {
                  columns: {
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!room) return null;

    return {
      roomId: room.id,
      room: {
        code: room.code,
        status: room.status,
        visibility: room.visibility,
        minPlayers: room.minPlayers,
        maxPlayers: room.maxPlayers,
        hostUserId: room.hostUserId,
        autoStartAt: room.autoStartAt?.toISOString() ?? null,
        expiresAt: room.expiresAt?.toISOString() ?? null,
        members: room.members.map((member) => ({
          userId: member.userId,
          username: sanitizeDisplayName(member.user.username, 32) || "user",
          avatar: sanitizeAvatarUrl(member.user.profile?.avatar ?? null),
          slot: member.colorSlot,
          ready: !!member.readyAt,
          joinedAt: member.joinedAt,
          leftAt: member.leftAt,
        })),
      },
    };
  }
}
