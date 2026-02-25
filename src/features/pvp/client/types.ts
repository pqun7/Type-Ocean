export type ServerMessage =
  | { type: "HELLO_OK"; payload: { user: { userId: string; username: string; avatar: string | null } } }
  | { type: "QUEUE_STATUS"; payload: { status: string } }
  | {
      type: "ROOM_STATE";
      payload: {
        room: {
          code: string;
          status: string;
          maxPlayers: number;
          members: Array<{ userId: string; username: string; avatar: string | null; slot: number; ready: boolean }>;
        };
      };
    }
  | {
      type: "MATCH_FOUND";
      payload: {
        matchId: string;
        textSnapshot: string;
        serverStartAt: string;
        players: Array<{ userId: string; username: string; avatar: string | null; slot: number }>;
      };
    }
  | {
      type: "MATCH_STATE";
      payload: {
        matchId: string;
        roomCode: string | null;
        status: string;
        textSnapshot: string;
        serverStartAt: string;
        players: Array<{ userId: string; username: string; avatar: string | null; slot: number; caretIndex: number }>;
      };
    }
  | {
      type: "PROGRESS";
      payload: {
        matchId: string;
        userId: string;
        caretIndex: number;
        wpm: number;
        accuracy: number;
        errors: number;
        serverNowMs?: number;
      };
    }
  | {
      type: "RESULTS";
      payload: {
        matchId: string;
        placements: Array<{
          position: number;
          userId: string;
          username: string;
          wpm: number;
          accuracy: number;
          errors: number;
          timeMs: number;
        }>;
        ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }>;
      };
    }
  | { type: "REMATCH_OFFER"; payload: { matchId: string; fromUserId: string } }
  | {
      type: "REMATCH_DECLINED";
      payload: { matchId: string; byUserId: string; reason?: string };
    }
  | {
      type: "REMATCH_STATUS";
      payload: { matchId: string; acceptedUserIds: string[] };
    }
  | { type: "ERROR"; payload: { message: string } };

export type ClientMessage =
  | { type: "HELLO"; payload: { token: string } }
    | { type: "QUEUE_JOIN"; payload: Record<string, never> }
    | { type: "QUEUE_LEAVE"; payload: Record<string, never> }
  | { type: "ROOM_JOIN"; payload: { code: string } }
  | { type: "READY"; payload?: { roomCode?: string } }
  | { type: "MATCH_JOIN"; payload: { matchId: string } }
  | { type: "INPUT_UPDATE"; payload: { matchId: string; input: string; seq: number; clientTs?: number } }
  | { type: "FINISH"; payload: { matchId: string; clientTs?: number } }
  | { type: "REMATCH_REQUEST"; payload: { matchId: string } }
  | { type: "REMATCH_RESPONSE"; payload: { matchId: string; accept: boolean } };
