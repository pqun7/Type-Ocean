import WebSocket from "ws";

export type WsConnLike = WebSocket & {
  user?: { userId: string };
  matchId?: string;
  roomCode?: string;
};

/**
 * Ultra-hot runtime cache only. Lifecycle authority remains in Postgres.
 */
export class MatchCache {
  private readonly socketsByMatchId = new Map<string, Set<WsConnLike>>();
  private readonly socketsByUserId = new Map<string, Set<WsConnLike>>();
  private readonly socketsByRoomCode = new Map<string, Set<WsConnLike>>();
  private readonly aiTickStateByMatchId = new Map<string, { tickMs: number; lastFlushAtMs: number }>();

  addSocket(matchId: string, socket: WsConnLike) {
    let matchSet = this.socketsByMatchId.get(matchId);
    if (!matchSet) {
      matchSet = new Set<WsConnLike>();
      this.socketsByMatchId.set(matchId, matchSet);
    }
    matchSet.add(socket);
  }

  addUserSocket(socket: WsConnLike) {
    const userId = socket.user?.userId;
    if (!userId) return;

    let userSet = this.socketsByUserId.get(userId);
    if (!userSet) {
      userSet = new Set<WsConnLike>();
      this.socketsByUserId.set(userId, userSet);
    }
    userSet.add(socket);
  }

  removeUserSocket(socket: WsConnLike) {
    const userId = socket.user?.userId;
    if (!userId) return;

    const userSet = this.socketsByUserId.get(userId);
    if (!userSet) return;

    userSet.delete(socket);
    if (userSet.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  addRoomSocket(roomCode: string, socket: WsConnLike) {
    let roomSet = this.socketsByRoomCode.get(roomCode);
    if (!roomSet) {
      roomSet = new Set<WsConnLike>();
      this.socketsByRoomCode.set(roomCode, roomSet);
    }
    roomSet.add(socket);
  }

  removeRoomSocket(roomCode: string, socket: WsConnLike) {
    const roomSet = this.socketsByRoomCode.get(roomCode);
    if (!roomSet) return;

    roomSet.delete(socket);
    if (roomSet.size === 0) {
      this.socketsByRoomCode.delete(roomCode);
    }
  }

  removeSocket(matchId: string, socket: WsConnLike) {
    const matchSet = this.socketsByMatchId.get(matchId);
    if (matchSet) {
      matchSet.delete(socket);
      if (matchSet.size === 0) {
        this.socketsByMatchId.delete(matchId);
      }
    }
  }

  getMatchSockets(matchId: string) {
    return this.socketsByMatchId.get(matchId) ?? new Set<WsConnLike>();
  }

  getUserSockets(userId: string) {
    return this.socketsByUserId.get(userId) ?? new Set<WsConnLike>();
  }

  getRoomSockets(roomCode: string) {
    return this.socketsByRoomCode.get(roomCode) ?? new Set<WsConnLike>();
  }

  broadcastToMatch(matchId: string, serializedMessage: string) {
    const sockets = this.socketsByMatchId.get(matchId);
    if (!sockets) return 0;

    let delivered = 0;
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(serializedMessage);
        delivered += 1;
      } catch {
        // ignore single-socket send failure and continue fanout.
      }
    }
    return delivered;
  }

  /**
   * Sends a PROGRESS message directly to all sockets associated with a match.
   */
  broadcastProgress(matchId: string, payload: unknown) {
    return this.broadcastToMatch(matchId, JSON.stringify({ type: "PROGRESS", payload }));
  }

  /**
   * Returns the number of AI simulations currently tracked in hot runtime cache.
   */
  getActiveAiMatchCount() {
    return this.aiTickStateByMatchId.size;
  }

  setAiTickState(matchId: string, value: { tickMs: number; lastFlushAtMs: number }) {
    this.aiTickStateByMatchId.set(matchId, value);
  }

  getAiTickState(matchId: string) {
    return this.aiTickStateByMatchId.get(matchId) ?? null;
  }

  clearAiTickState(matchId: string) {
    this.aiTickStateByMatchId.delete(matchId);
  }

  clearMatch(matchId: string) {
    this.socketsByMatchId.delete(matchId);
    this.aiTickStateByMatchId.delete(matchId);
  }
}
