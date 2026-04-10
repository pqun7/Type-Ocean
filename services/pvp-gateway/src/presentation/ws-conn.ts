import type WebSocket from "ws";
import type { MatchId, RoomCode } from "../shared/branded-ids";
import type { ConnectionUser } from "../state";
import type { WsAuthContext } from "../auth";
import type { TokenBucket } from "../rate-limit";

/**
 * Augmented WebSocket connection with per-connection metadata.
 * Lives in the presentation layer because it is tightly coupled to the
 * `ws` transport and per-socket runtime state.
 */
export interface WsConn extends WebSocket {
  connectionId?: string;
  user?: ConnectionUser & Pick<WsAuthContext, "tokenVersion" | "validAfter" | "issuedAt">;
  authBypass?: boolean;
  matchId?: MatchId;
  matchSessionKey?: string;
  roomCode?: RoomCode;
  ip?: string;
  rl?: { general: TokenBucket; input: TokenBucket; roomAction: TokenBucket };
  rawMsgStrikes?: number;
  presenceInterval?: NodeJS.Timeout | null;
  /** Per-socket rate-limit state for MATCH_SYNC_REQUEST. */
  matchSyncRequests?: { count: number; windowStartMs: number };
}
