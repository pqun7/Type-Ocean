export type RoomMemberLifecycle = {
  userId: string;
  joinedAt: Date;
  readyAt: Date | null;
  leftAt: Date | null;
};

export function getActiveRoomMembers<T extends Pick<RoomMemberLifecycle, "leftAt">>(members: T[]) {
  return members.filter((member) => member.leftAt === null);
}

export function selectNextRoomHost(
  members: RoomMemberLifecycle[],
  currentHostUserId: string | null | undefined
) {
  const activeMembers = members
    .filter((member) => member.leftAt === null)
    .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime());

  if (!activeMembers.length) return null;

  if (currentHostUserId && activeMembers.some((member) => member.userId === currentHostUserId)) {
    return currentHostUserId;
  }

  return activeMembers[0]!.userId;
}

export function isRoomReadyToStart(params: {
  members: Array<Pick<RoomMemberLifecycle, "leftAt" | "readyAt">>;
  minimumPlayers?: number;
}) {
  const minimumPlayers = params.minimumPlayers ?? 2;
  const activeMembers = getActiveRoomMembers(params.members);
  return activeMembers.length >= minimumPlayers && activeMembers.every((member) => member.readyAt != null);
}

export function getPublicRoomStartCondition(params: {
  members: Array<Pick<RoomMemberLifecycle, "leftAt" | "readyAt">>;
  minimumPlayers?: number;
  maxPlayers: number;
  autoStartAt?: Date | null;
  nowMs?: number;
}) {
  const minimumPlayers = params.minimumPlayers ?? 2;
  const activeMembers = getActiveRoomMembers(params.members);

  if (activeMembers.length < minimumPlayers) {
    return null;
  }

  if (activeMembers.every((member) => member.readyAt != null)) {
    return "all_ready" as const;
  }

  if (activeMembers.length >= params.maxPlayers) {
    return "room_full" as const;
  }

  if (params.autoStartAt && params.autoStartAt.getTime() <= (params.nowMs ?? Date.now())) {
    return "timeout" as const;
  }

  return null;
}

export function buildRoomReconnectKey(roomId: string, userId: string) {
  return `pvp:room:reconnect:${roomId}:${userId}`;
}