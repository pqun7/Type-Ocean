import type { PvpErrorPayload } from "@/features/pvp/shared/error-codes";

export type ServerMessage =
  | { type: "HELLO_OK"; payload: { user: { userId: string; username: string; avatar: string | null; rating?: number; rankTier?: string; averageWpm?: number | null; bestWpm?: number | null; avgAcc?: number | null } } }
  | { type: "AUTH_REFRESH_OK"; payload: { expiresAt: number; user?: { userId: string; username: string; avatar: string | null; rating?: number; rankTier?: string; averageWpm?: number | null; bestWpm?: number | null; avgAcc?: number | null } } }
  | { type: "QUEUE_STATUS"; payload: { status: string } }
  | {
      type: "ROOM_STATE";
      payload: {
        room: {
          code: string;
          status: string;
          minPlayers?: number;
          maxPlayers: number;
          hostUserId?: string | null;
          expiresAt?: string | null;
          members: Array<{ userId: string; username: string; avatar: string | null; slot: number; ready: boolean; rating?: number | null; rankTier?: string | null; averageWpm?: number | null }>;
        };
      };
    }
  | {
      type: "MATCH_FOUND";
      payload: {
        matchId: string;
        textSnapshot: string;
        textId?: string | null;
        inputNonce?: string | null;
        serverStartAt: string;
        players: Array<{
          userId: string;
          username: string;
          avatar: string | null;
          slot: number;
          rating?: number;
          rankTier?: string;
          averageWpm?: number | null;
          bestWpm?: number | null;
          avgAcc?: number | null;
        }>;
      };
    }
  | {
      type: "MATCH_STATE";
      payload: {
        matchId: string;
        revision: number;
        roomCode: string | null;
        status: string;
        textSnapshot: string;
        textId?: string | null;
        inputNonce?: string | null;
        serverStartAt: string;
        snapshotAt: string;
        players: Array<{
          userId: string;
          username: string;
          avatar: string | null;
          slot: number;
          caretIndex: number;
          wpm: number;
          accuracy: number;
          errors: number;
          finishedAt: string | null;
        }>;
      };
    }
  | {
      type: "MATCH_ENDED";
      payload: {
        matchId: string;
        reason: "opponent_disconnected" | "completed" | "aborted" | "no_show";
        message: string;
        finalResultsPending?: boolean;
      };
    }
  | {
      type: "PROGRESS";
      payload: {
        matchId: string;
        revision: number;
        status: string;
        userId: string;
        caretIndex: number;
        wpm: number;
        accuracy: number;
        errors: number;
        finishedAt: string | null;
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
  | { type: "COUNTDOWN_TICK"; payload: { matchId: string; remainingSeconds: number } }
  | { type: "REMATCH_OFFER"; payload: { matchId: string; fromUserId: string } }
  | {
      type: "REMATCH_DECLINED";
      payload: { matchId: string; byUserId: string; reason?: string };
    }
  | {
      type: "REMATCH_STATUS";
      payload: { matchId: string; acceptedUserIds: string[] };
    }
  | { type: "ERROR"; payload: PvpErrorPayload }
  | {
      type: "LOBBY_CHAT";
      payload: { roomCode: string; userId: string; username: string; text: string; ts: number };
    }
  | { type: "ROOM_UPDATE_ACK"; payload: { roomCode: string; maxPlayers: number } }
  | { type: "PONG"; payload?: Record<string, never> };

export type ClientMessage =
  | { type: "HELLO"; payload: { token: string; clientSecret: string }; requestId?: string }
  | { type: "AUTH_REFRESH"; payload: { token: string; clientSecret: string }; requestId?: string }
  | { type: "QUEUE_JOIN"; payload: { language?: "en" | "ar" }; requestId?: string }
  | { type: "QUEUE_LEAVE"; payload: Record<string, never>; requestId?: string }
  | { type: "ROOM_JOIN"; payload: { code: string }; requestId?: string }
  | { type: "READY"; payload?: { roomCode?: string }; requestId?: string }
  | { type: "ROOM_LEAVE"; payload?: { roomCode?: string }; requestId?: string }
  | { type: "ROOM_START"; payload: { roomCode?: string }; requestId?: string }
  | { type: "ROOM_KICK"; payload: { roomCode?: string; userId: string }; requestId?: string }
  | { type: "MATCH_JOIN"; payload: { matchId: string; lastSeenRevision?: number }; requestId?: string }
  | { type: "MATCH_LEAVE"; payload: { matchId: string }; requestId?: string }
  | {
      type: "INPUT_UPDATE";
      payload: { matchId: string; input: string; seq: number; clientTs?: number; inputNonce?: string; totalMistakes?: number };
      requestId?: string;
    }
  | { type: "FINISH"; payload: { matchId: string; clientTs?: number }; requestId?: string }
  | { type: "REMATCH_REQUEST"; payload: { matchId: string }; requestId?: string }
  | { type: "REMATCH_RESPONSE"; payload: { matchId: string; accept: boolean }; requestId?: string }
  | { type: "MATCH_SYNC_REQUEST"; payload: { matchId: string }; requestId?: string }
  | { type: "PING"; payload?: Record<string, never>; requestId?: string }
  | { type: "LOBBY_CHAT"; payload: { roomCode?: string; text: string }; requestId?: string }
  | { type: "ROOM_UPDATE"; payload: { roomCode?: string; maxPlayers: number }; requestId?: string };
