 "use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Swords, Timer } from "lucide-react";

import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import type { ClientMessage, ServerMessage } from "@/features/pvp/client/types";
import { PVP_ERROR_CODES } from "@/features/pvp/shared/error-codes";
import { Button } from "@/components/ui/button";
import { useLevel } from "@/features/level/hooks/useLevel";
import { useSettings } from "@/features/settings/context";
import { getTypingFontClass } from "@/features/settings/typingFonts";

import TypingTest from "@/components/TypingTest/TypingTest";
import Caret from "@/components/TypingTest/Caret";
import type { ValidatedTypingStats } from "@/components/TypingTest/TypingTest";
import usePvpTyping from "@/features/pvp/client/usePvpTyping";

const MemoizedCaret = memo(Caret);

import { getCaretPositionForIndex } from "@/features/typing/hooks/useCaret";
import PvpResultsOverlay from "@/components/pvp/PvpResultsOverlay";

function slotToColor(slot: number) {
  switch (slot % 6) {
    case 0:
      return "bg-blue-400";
    case 1:
      return "bg-pink-400";
    case 2:
      return "bg-green-400";
    case 3:
      return "bg-yellow-400";
    case 4:
      return "bg-purple-400";
    default:
      return "bg-orange-400";
  }
}

type MatchStatePayload = Extract<ServerMessage, { type: "MATCH_STATE" }>['payload'];
type ProgressPayload = Extract<ServerMessage, { type: "PROGRESS" }>['payload'];

type PlayerProgressTracking = {
  historyByUserId: Record<string, Array<{ tMs: number; wpm: number }>>;
  lastSampleAtByUserId: Record<string, number>;
};

type MatchPlaybackApplication = PlayerProgressTracking & {
  revision: number;
  status: string;
  text?: string;
  textId?: string | null;
  serverStartAt?: string;
  roomCode?: string | null;
  waitingSinceMs?: number | null;
  players?: Array<{ userId: string; username: string; avatar: string | null; slot: number }>;
  carets: Record<string, number>;
  caretsMode: "replace" | "merge";
  localServerInput: string | null;
  shouldFocus: boolean;
};

function ensureProgressTrackingForUsers(params: {
  userIds: string[];
  historyByUserId: Record<string, Array<{ tMs: number; wpm: number }>>;
  lastSampleAtByUserId: Record<string, number>;
}): PlayerProgressTracking {
  const historyByUserId = { ...params.historyByUserId };
  const lastSampleAtByUserId = { ...params.lastSampleAtByUserId };

  for (const userId of params.userIds) {
    historyByUserId[userId] = historyByUserId[userId] ?? [];
    lastSampleAtByUserId[userId] = lastSampleAtByUserId[userId] ?? 0;
  }

  return { historyByUserId, lastSampleAtByUserId };
}

function applyProgressSample(params: {
  userId: string;
  wpm: number;
  sampleAtMs: number;
  historyByUserId: Record<string, Array<{ tMs: number; wpm: number }>>;
  lastSampleAtByUserId: Record<string, number>;
}): PlayerProgressTracking {
  const tracked = ensureProgressTrackingForUsers({
    userIds: [params.userId],
    historyByUserId: params.historyByUserId,
    lastSampleAtByUserId: params.lastSampleAtByUserId,
  });

  const lastAt = tracked.lastSampleAtByUserId[params.userId] ?? 0;
  if (params.sampleAtMs - lastAt < 250) {
    return tracked;
  }

  tracked.lastSampleAtByUserId[params.userId] = params.sampleAtMs;
  tracked.historyByUserId[params.userId] = [
    ...(tracked.historyByUserId[params.userId] ?? []),
    { tMs: params.sampleAtMs, wpm: params.wpm },
  ];

  return tracked;
}

function buildMatchStateApplication(params: {
  payload: MatchStatePayload;
  currentRevision: number;
  currentWaitingSinceMs: number | null;
  localUserId: string | null;
  historyByUserId: Record<string, Array<{ tMs: number; wpm: number }>>;
  lastSampleAtByUserId: Record<string, number>;
}): MatchPlaybackApplication | null {
  const { payload } = params;
  if (payload.revision < params.currentRevision) {
    return null;
  }

  const players = payload.players.map((player) => ({
    userId: player.userId,
    username: player.username,
    avatar: player.avatar,
    slot: player.slot,
  }));

  const carets: Record<string, number> = {};
  for (const player of payload.players) {
    carets[player.userId] = player.caretIndex;
  }

  const tracking = ensureProgressTrackingForUsers({
    userIds: payload.players.map((player) => player.userId),
    historyByUserId: params.historyByUserId,
    lastSampleAtByUserId: params.lastSampleAtByUserId,
  });

  const localPlayer = params.localUserId
    ? payload.players.find((player) => player.userId === params.localUserId)
    : undefined;

  return {
    revision: payload.revision,
    text: payload.textSnapshot,
    textId: payload.textId ?? null,
    serverStartAt: payload.serverStartAt,
    roomCode: payload.roomCode ?? null,
    status: payload.status,
    carets,
    caretsMode: "replace",
    waitingSinceMs:
      payload.status === "PENDING" && payload.players.length < 2
        ? params.currentWaitingSinceMs ?? Date.now()
        : null,
    players,
    localServerInput:
      localPlayer && payload.textSnapshot
        ? payload.textSnapshot.slice(0, localPlayer.caretIndex)
        : null,
    historyByUserId: tracking.historyByUserId,
    lastSampleAtByUserId: tracking.lastSampleAtByUserId,
    shouldFocus: params.currentRevision === 0,
  };
}

function buildProgressApplication(params: {
  payload: ProgressPayload;
  currentRevision: number;
  currentText: string;
  localUserId: string | null;
  historyByUserId: Record<string, Array<{ tMs: number; wpm: number }>>;
  lastSampleAtByUserId: Record<string, number>;
}): MatchPlaybackApplication | null {
  const { payload } = params;
  if (payload.revision <= params.currentRevision) {
    return null;
  }

  const sampleAtMs = typeof payload.serverNowMs === "number" ? payload.serverNowMs : Date.now();
  const tracking = applyProgressSample({
    userId: payload.userId,
    wpm: payload.wpm,
    sampleAtMs,
    historyByUserId: params.historyByUserId,
    lastSampleAtByUserId: params.lastSampleAtByUserId,
  });

  return {
    revision: payload.revision,
    status: payload.status,
    carets: { [payload.userId]: payload.caretIndex },
    caretsMode: "merge",
    localServerInput:
      params.localUserId === payload.userId && params.currentText
        ? params.currentText.slice(0, payload.caretIndex)
        : null,
    historyByUserId: tracking.historyByUserId,
    lastSampleAtByUserId: tracking.lastSampleAtByUserId,
    shouldFocus: false,
  };
}

// ── Match phase state machine ────────────────────────────────────────────────

type MatchPhase = 'PENDING' | 'COUNTDOWN' | 'RUNNING' | 'ENDING' | 'FINISHED';

const MATCH_PHASE_TRANSITIONS: Record<MatchPhase, MatchPhase[]> = {
  PENDING:   ['COUNTDOWN', 'RUNNING', 'ENDING', 'FINISHED'],
  COUNTDOWN: ['RUNNING', 'ENDING', 'FINISHED'],
  RUNNING:   ['ENDING', 'FINISHED'],
  ENDING:    ['FINISHED'],
  FINISHED:  [],
};

/**
 * Returns true when `to` is a permitted forward transition from `from`,
 * or when `from === to` (idempotent resync of the same phase).
 */
function isValidPhaseTransition(from: MatchPhase, to: string): to is MatchPhase {
  if (from === (to as MatchPhase)) return true;
  return (MATCH_PHASE_TRANSITIONS[from] as string[]).includes(to);
}

// Must match MATCH_NO_SHOW_TIMEOUT_MS in the gateway config (services/pvp-gateway/src/shared/config.ts).
const WAITING_TIMEOUT_MS = 40_000;

export default function PvpMatchClient({ matchId }: { matchId: string }) {
  const { settings } = useSettings();
  const router = useRouter();
  const { status, user, send, addListener, getLatestMatchSnapshot, connectionPhase } = usePvpSocket();
  const { addXPMessage } = useLevel();
  const addXPMessageRef = useRef(addXPMessage);
  useEffect(() => { addXPMessageRef.current = addXPMessage; }, [addXPMessage]);

  // Active match ID for in-place rematch — starts equal to the prop,
  // but can be swapped without navigation when a rematch starts.
  const [activeMatchId, setActiveMatchId] = useState(matchId);
  const activeMatchIdRef = useRef(matchId);

  const [text, setText] = useState<string>("");
  const [textId, setTextId] = useState<string | null>(null);
  const [serverStartAt, setServerStartAt] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<MatchPhase>('PENDING');
  const [players, setPlayers] = useState<Array<{ userId: string; username: string; avatar: string | null; slot: number }>>(
    []
  );
  const [carets, setCarets] = useState<Record<string, number>>({});
  const [remoteCaretPositions, setRemoteCaretPositions] = useState<Record<string, { x: number; y: number }>>({});

  const seqRef = useRef(0);
  const revisionRef = useRef(0);
  const lastSentAtRef = useRef(0);

  const wpmHistoryRef = useRef<Record<string, Array<{ tMs: number; wpm: number }>>>({});
  const lastSampleAtRef = useRef<Record<string, number>>({});

  const [rematchOfferFromUserId, setRematchOfferFromUserId] = useState<string | null>(null);
  const [rematchAcceptedUserIds, setRematchAcceptedUserIds] = useState<string[]>([]);
  const [rematchDeclinedReason, setRematchDeclinedReason] = useState<string | null>(null);
  const [isSearchingNewOpponent, setIsSearchingNewOpponent] = useState(false);
  const [matchEndingNotice, setMatchEndingNotice] = useState<string | null>(null);
  const [hasReceivedMatchState, setHasReceivedMatchState] = useState(false);
  const [waitingSinceMs, setWaitingSinceMs] = useState<number | null>(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showGoOverlay, setShowGoOverlay] = useState(false);
  const [isCountdownOverlayVisible, setIsCountdownOverlayVisible] = useState(false);
  const previousMatchStatusRef = useRef<MatchPhase | ''>('');
  /** Countdown integer: 3 → 2 → 1 → 0. Set by COUNTDOWN_TICK and/or the rAF timer. */
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  /** Timestamp when we entered COUNTDOWN state (for timeout detection). */
  const countdownEnteredAtRef = useRef<number | null>(null);
  /**
   * Batching-immune ref: set synchronously in the message listener when a
   * MATCH_STATE with status=COUNTDOWN is received.  React 18 automatic batching
   * can merge COUNTDOWN + RUNNING state updates into a single commit, which
   * causes the previousMatchStatusRef to never see "COUNTDOWN".  This ref
   * guarantees the GO overlay triggers even when React skips the intermediate
   * COUNTDOWN render.
   */
  const hasSeenCountdownRef = useRef(false);
  const countdownPhaseRef = useRef<"idle" | "active" | "go_shown">("idle");
  /**
   * Tracks how many MATCH_SYNC_REQUEST messages have been sent during the
   * current COUNTDOWN phase.  Reset to 0 whenever we leave COUNTDOWN.
   * Capped at 3 so we never spam the gateway.
   */
  const syncRequestCountRef = useRef(0);

  const [myWpm, setMyWpm] = useState(0);
  const [opponentWpm, setOpponentWpm] = useState<number | null>(null);

  const [results, setResults] = useState<null | {
    placements: Array<{ position: number; userId: string; username: string; wpm: number; accuracy: number; errors: number; timeMs: number }>;
    ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }>;
  }>(null);
  const statusRef = useRef(status);
  const phaseRef = useRef<MatchPhase>('PENDING');
  const resultsRef = useRef(results);
  const textRef = useRef(text);
  const waitingSinceMsRef = useRef(waitingSinceMs);
  const latestMatchSnapshot = getLatestMatchSnapshot(activeMatchId);
  const inputNonce = latestMatchSnapshot?.inputNonce ?? null;

  // ---- Mid-match reconnection resilience ----
  /** Outbound INPUT_UPDATE / FINISH messages buffered while the socket is down. */
  const pendingInputBufferRef = useRef<ClientMessage[]>([]);
  /** Epoch ms when the connection dropped during an active match, or null. */
  const connectionDroppedAtRef = useRef<number | null>(null);
  /** True after 90 s of unrecoverable connection loss during active play. */
  const [matchRecoveryFailed, setMatchRecoveryFailed] = useState(false);
  /** Stable ref for the current user's id — safe to read inside stable callbacks. */
  const meIdRef = useRef<string | null>(null);

  useEffect(() => {
    meIdRef.current = user?.userId ?? null;
  }, [user?.userId]);

  /**
   * Send a gameplay message.  If the socket is currently down, buffer it so
   * it can be flushed when the connection is restored — the game continues
   * locally without any visible disruption.
   */
  const sendOrBuffer = useCallback(
    (msg: ClientMessage): void => {
      const sent = send(msg);
      if (!sent) {
        pendingInputBufferRef.current.push(msg);
        if (connectionDroppedAtRef.current === null) {
          connectionDroppedAtRef.current = Date.now();
        }
      } else {
        connectionDroppedAtRef.current = null;
      }
    },
    [send],
  );

  /**
   * Receives validated keystrokes from TypingTest and forwards them to the
   * server.  TypingTest / useTypingLogic has already: capped the input to the
   * text length, tracked grapheme-accurate mismatches, and determined whether
   * the text is complete — so this callback only needs to throttle INPUT_UPDATE
   * and send FINISH exactly once.
   */
  const handlePvpInput = useCallback(
    (input: string, _graphemesTyped: number, isComplete: boolean, stats: ValidatedTypingStats) => {
      if (phaseRef.current !== 'RUNNING') return;

      const now = Date.now();
      const canSend = now - lastSentAtRef.current >= 60;

      if (canSend || isComplete) {
        if (canSend) {
          lastSentAtRef.current = now;
          seqRef.current += 1;
          sendOrBuffer({
            type: "INPUT_UPDATE",
            payload: {
              matchId: activeMatchIdRef.current,
              input,
              seq: seqRef.current,
              clientTs: now,
              inputNonce: inputNonce ?? undefined,
              totalMistakes: stats.totalMistakes,
            },
          });
        }
        if (isComplete) {
          sendOrBuffer({ type: "FINISH", payload: { matchId: activeMatchIdRef.current, clientTs: now } });
        }
      }
    },
    [inputNonce, sendOrBuffer],
  );

  const { actionsRef: pvpActionsRef, typingTestProps: pvpTypingTestProps } = usePvpTyping({
    controlledText: text,
    onInputValidated: handlePvpInput,
  });

  // Flush buffered inputs the moment the socket is ready again.
  useEffect(() => {
    if (connectionPhase.kind !== "ready") return;
    connectionDroppedAtRef.current = null;
    const buffer = pendingInputBufferRef.current.splice(0);
    for (const msg of buffer) {
      send(msg);
    }
  }, [connectionPhase.kind, send]);

  // After 90 s of irrecoverable mid-match disconnection, show a minimal end screen.
  useEffect(() => {
    if (results !== null || phase === 'FINISHED' || phase === 'ENDING') return;
    if (
      connectionPhase.kind === "ready" ||
      connectionPhase.kind === "idle" ||
      connectionPhase.kind === "connecting"
    ) {
      connectionDroppedAtRef.current = null;
      return;
    }
    if (connectionDroppedAtRef.current === null) {
      connectionDroppedAtRef.current = Date.now();
    }
    const droppedAt = connectionDroppedAtRef.current;
    const remaining = Math.max(0, 90_000 - (Date.now() - droppedAt));
    const timer = window.setTimeout(() => {
      if (connectionDroppedAtRef.current !== null) {
        setMatchRecoveryFailed(true);
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [connectionPhase.kind, results, phase]);

  // Sync activeMatchId when the prop changes (direct URL navigation).
  useEffect(() => {
    setActiveMatchId(matchId);
    activeMatchIdRef.current = matchId;
  }, [matchId]);

  /** Reset all per-match state to initial values. */
  const resetMatchState = useCallback(() => {
    setText("");
    setTextId(null);
    setServerStartAt(null);
    setRoomCode(null);
    phaseRef.current = 'PENDING';
    setPhase('PENDING');
    setPlayers([]);
    setCarets({});
    setRemoteCaretPositions({});
    seqRef.current = 0;
    revisionRef.current = 0;
    lastSentAtRef.current = 0;
    wpmHistoryRef.current = {};
    lastSampleAtRef.current = {};
    setResults(null);
    setRematchOfferFromUserId(null);
    setRematchAcceptedUserIds([]);
    setRematchDeclinedReason(null);
    setIsSearchingNewOpponent(false);
    setMatchEndingNotice(null);
    setWaitingSinceMs(Date.now());
    setNowMs(Date.now());
    setMatchRecoveryFailed(false);
    setHasReceivedMatchState(false);
    setCountdownSeconds(null);
    setShowGoOverlay(false);
    setIsCountdownOverlayVisible(false);
    hasSeenCountdownRef.current = false;
    countdownPhaseRef.current = "idle";
    syncRequestCountRef.current = 0;
    countdownEnteredAtRef.current = null;
    pendingInputBufferRef.current = [];
    connectionDroppedAtRef.current = null;
    setMyWpm(0);
    setOpponentWpm(null);
  }, []);

  // Reset per-match state when active match changes.
  useEffect(() => {
    resetMatchState();
  }, [activeMatchId, resetMatchState]);

  const isWaitingForOpponent = hasReceivedMatchState && phase === 'PENDING' && players.length < 2 && !results;

  // Refresh nowMs for the waiting-for-opponent timer.
  // Uses a rAF loop that only calls setState when the displayed integer second
  // changes — eliminates ~160 extra re-renders compared to setInterval(250ms).
  useEffect(() => {
    if (!isWaitingForOpponent) return;
    let rafId: number;
    let lastSec = -1;
    const tick = () => {
      const now = Date.now();
      const newSec = waitingSinceMs
        ? Math.max(0, Math.ceil((waitingSinceMs + WAITING_TIMEOUT_MS - now) / 1000))
        : 40;
      if (newSec !== lastSec) {
        lastSec = newSec;
        setNowMs(now);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isWaitingForOpponent, waitingSinceMs]);

  useEffect(() => {
    if (status !== "ready") return;
    send({
      type: "MATCH_JOIN",
      payload: {
        matchId: activeMatchId,
        lastSeenRevision: Math.max(0, revisionRef.current),
      },
    });
  }, [status, send, activeMatchId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    waitingSinceMsRef.current = waitingSinceMs;
  }, [waitingSinceMs]);

  useEffect(() => {
    const previousStatus = previousMatchStatusRef.current;
    // Use hasSeenCountdownRef to detect the COUNTDOWN→RUNNING transition even
    // when React 18 batching merges both phase updates into a single commit
    // (previousStatus would still be "PENDING" in that case).
    const sawCountdown = previousStatus === "COUNTDOWN" || hasSeenCountdownRef.current;
    if (sawCountdown && phase === 'RUNNING' && countdownPhaseRef.current !== "go_shown") {
      countdownPhaseRef.current = "go_shown";
      hasSeenCountdownRef.current = false;
      setIsCountdownOverlayVisible(false);
      setShowGoOverlay(true);
      const overlayTimer = window.setTimeout(() => setShowGoOverlay(false), 700);
      const focusTimer = window.setTimeout(() => pvpActionsRef.current?.focus(), 50);
      previousMatchStatusRef.current = phase;
      return () => {
        window.clearTimeout(overlayTimer);
        window.clearTimeout(focusTimer);
      };
    }

    previousMatchStatusRef.current = phase;
    return undefined;
  }, [phase, pvpActionsRef]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const commitPlaybackApplication = useCallback((nextState: MatchPlaybackApplication) => {
    revisionRef.current = nextState.revision;
    if (nextState.text !== undefined) {
      setText(nextState.text);
    }
    if (nextState.textId !== undefined) {
      setTextId(nextState.textId);
    }
    if (nextState.serverStartAt !== undefined) {
      setServerStartAt(nextState.serverStartAt);
    }
    if (nextState.roomCode !== undefined) {
      setRoomCode(nextState.roomCode);
    }

    const nextPhase = nextState.status as MatchPhase;
    phaseRef.current = nextPhase;
    setPhase(nextPhase);

    if (nextState.waitingSinceMs !== undefined) {
      setWaitingSinceMs(nextState.waitingSinceMs);
    }
    if (nextState.players !== undefined) {
      setPlayers(nextState.players);
    }

    if (nextState.caretsMode === "replace") {
      setCarets(nextState.carets);
    } else {
      setCarets((prev) => ({ ...prev, ...nextState.carets }));
    }

    if (nextState.localServerInput !== null && phaseRef.current === 'RUNNING') {
      pvpActionsRef.current?.syncInput(nextState.localServerInput);
    }

    wpmHistoryRef.current = nextState.historyByUserId;
    lastSampleAtRef.current = nextState.lastSampleAtByUserId;

    if (nextState.shouldFocus) {
      setTimeout(() => pvpActionsRef.current?.focus(), 50);
    }
  }, [pvpActionsRef]);

  const applyMatchStateSnapshot = useCallback((payload: MatchStatePayload) => {
    setHasReceivedMatchState(true);

    const nextState = buildMatchStateApplication({
      payload,
      currentRevision: revisionRef.current,
      currentWaitingSinceMs: waitingSinceMsRef.current,
      localUserId: meIdRef.current,
      historyByUserId: wpmHistoryRef.current,
      lastSampleAtByUserId: lastSampleAtRef.current,
    });
    if (!nextState) return;

    commitPlaybackApplication(nextState);
  }, [commitPlaybackApplication]);

  const applyProgressSnapshot = useCallback((payload: ProgressPayload) => {
    // Reject progress updates outside the RUNNING phase — prevents
    // applying stale replays or out-of-order messages during COUNTDOWN/PENDING.
    if (phaseRef.current !== 'RUNNING') return;
    const nextState = buildProgressApplication({
      payload,
      currentRevision: revisionRef.current,
      currentText: textRef.current,
      localUserId: meIdRef.current,
      historyByUserId: wpmHistoryRef.current,
      lastSampleAtByUserId: lastSampleAtRef.current,
    });
    if (!nextState) return;

    commitPlaybackApplication(nextState);
  }, [commitPlaybackApplication]);

  useEffect(() => {
    return () => {
      if (statusRef.current !== "ready") return;
      if (resultsRef.current) return;
      if (phaseRef.current === 'FINISHED' || phaseRef.current === 'ENDING') return;
      send({ type: "MATCH_LEAVE", payload: { matchId: activeMatchIdRef.current } });
    };
  }, [activeMatchId, send]);

  useEffect(() => {
    return addListener((m) => {
      const currentMatchId = activeMatchIdRef.current;

      // In-place rematch: swap active match without navigation.
      // Server rejected MATCH_JOIN for this match (e.g. match is already
      // finished after a gateway restart). Show the recovery screen so the
      // user can navigate back to the queue.
      if (
        m.type === "ERROR" &&
        m.payload.code === PVP_ERROR_CODES.MATCH_JOIN_REJECTED
      ) {
        setMatchRecoveryFailed(true);
        return;
      }

      if (m.type === "MATCH_FOUND" && m.payload.matchId !== currentMatchId) {
        activeMatchIdRef.current = m.payload.matchId;
        resetMatchState();
        setActiveMatchId(m.payload.matchId);
        window.history.replaceState(null, "", `/pvp/match/${m.payload.matchId}`);
        return;
      }

      // Server-push countdown tick — set the visible countdown immediately,
      // even if MATCH_STATE with status=COUNTDOWN hasn't arrived yet.
      // This fixes the race where an early tick arrives before MATCH_STATE.
      if (m.type === "COUNTDOWN_TICK" && m.payload.matchId === currentMatchId) {
        setIsCountdownOverlayVisible(true);
        setCountdownSeconds(m.payload.remainingSeconds);
        return;
      }

      if (m.type === "MATCH_STATE" && m.payload.matchId === currentMatchId) {
        // Validate the phase transition before applying — reject backward or
        // invalid transitions (e.g. RUNNING → COUNTDOWN) to prevent state corruption.
        if (!isValidPhaseTransition(phaseRef.current, m.payload.status)) {
          return;
        }
        // Set hasSeenCountdownRef synchronously BEFORE any setState calls so it
        // survives React 18 automatic batching that may merge COUNTDOWN +
        // RUNNING into a single commit.
        if (m.payload.status === "COUNTDOWN") {
          hasSeenCountdownRef.current = true;
          setIsCountdownOverlayVisible(true);
        } else if (
          m.payload.status === "RUNNING" &&
          !hasSeenCountdownRef.current &&
          revisionRef.current === 0
        ) {
          // Late-join: the client arrived at a match that is already RUNNING
          // without passing through COUNTDOWN on this connection. This happens
          // when navigation takes longer than serverStartAtMs (first match from
          // /pvp/1v1 with a short start delay) or when serverStartAtMs was
          // already expired when arm() fired ("find new opponent" with an
          // exhausted queue timeout).  Arm the ref so the phase useEffect fires
          // the GO overlay + input focus, giving the player a clear signal that
          // the match has started.
          const startAt = m.payload.serverStartAt
            ? new Date(m.payload.serverStartAt).getTime()
            : null;
          if (!startAt || Date.now() - startAt < 12_000) {
            hasSeenCountdownRef.current = true;
          }
        }
        if (m.payload.status !== "COUNTDOWN" && m.payload.status !== "RUNNING") {
          setIsCountdownOverlayVisible(false);
        }
        applyMatchStateSnapshot(m.payload);
      }
      if (m.type === "PROGRESS" && m.payload.matchId === currentMatchId) {
        if (m.payload.userId !== meIdRef.current) {
          setOpponentWpm(m.payload.wpm);
        }
        applyProgressSnapshot(m.payload);
      }
      if (m.type === "MATCH_ENDED" && m.payload.matchId === currentMatchId) {
        phaseRef.current = 'ENDING';
        setPhase('ENDING');
        setMatchEndingNotice(m.payload.message);

        if (m.payload.reason === "no_show") {
          window.setTimeout(() => {
            router.push("/pvp/1v1?cancelled=no_show");
          }, 1200);
        }
      }
      if (m.type === "RESULTS" && m.payload.matchId === currentMatchId) {
        setMatchEndingNotice(null);
        setResults({ placements: m.payload.placements, ratingChanges: m.payload.ratingChanges });

        const localUserId = meIdRef.current;
        const myChange = localUserId
          ? m.payload.ratingChanges.find((c) => c.userId === localUserId)
          : undefined;

        // Show XP notification for ranked matches
        if (myChange !== undefined) {
          const isWin = myChange.delta > 0;
          if (isWin) {
            addXPMessageRef.current("Ranked Win", 100, "pvp-win");
          } else {
            addXPMessageRef.current("Ranked Match", 25, "pvp-win");
          }
        }

        // Fire-and-forget streak update (ranked 1v1 only — server validates internally).
        // Write optimistic localStorage cache so Pvp1v1Client shows the new streak immediately.
        if (m.payload.ratingChanges.length > 0) {
          void fetch("/api/pvp/streak/record", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchId: currentMatchId }),
          })
            .then(async (res) => {
              if (!res.ok || !localUserId) return;
              const data = await res.json() as { currentStreak?: number; streakBonus?: number };
              if (typeof data.currentStreak === "number") {
                try {
                  localStorage.setItem(
                    `pvp:streak:${localUserId}`,
                    JSON.stringify({ streak: data.currentStreak, ts: Date.now() }),
                  );
                } catch {
                  // localStorage unavailable (private browsing) — silent
                }
              }
              // Show streak bonus XP notification when a win streak earns a bonus
              if (typeof data.streakBonus === "number" && data.streakBonus > 0 && typeof data.currentStreak === "number") {
                const bonusXp = data.streakBonus * 5;
                addXPMessageRef.current(`Win Streak \u00d7${data.currentStreak}`, bonusXp, "pvp-streak");
              }
            })
            .catch(() => { /* network failure is non-fatal */ });
        }
      }

      if (m.type === "REMATCH_OFFER" && m.payload.matchId === currentMatchId) {
        setRematchDeclinedReason(null);
        setRematchOfferFromUserId(m.payload.fromUserId);
      }
      if (m.type === "REMATCH_STATUS" && m.payload.matchId === currentMatchId) {
        setRematchAcceptedUserIds(m.payload.acceptedUserIds);
      }
      if (m.type === "REMATCH_DECLINED" && m.payload.matchId === currentMatchId) {
        setRematchOfferFromUserId(null);
        setRematchAcceptedUserIds([]);
        setRematchDeclinedReason(m.payload.reason ?? "declined");
      }
    });
  }, [addListener, applyMatchStateSnapshot, applyProgressSnapshot, activeMatchId, resetMatchState, router]);

  const effectiveServerStartAt = latestMatchSnapshot?.serverStartAt ?? serverStartAt;
  const startAtMs = useMemo(
    () => {
      if (!effectiveServerStartAt) return null;
      const ms = new Date(effectiveServerStartAt).getTime();
      // Guard: reject NaN (malformed date string) — fall back to tick-driven display.
      return Number.isFinite(ms) ? ms : null;
    },
    [effectiveServerStartAt],
  );
  // countdownSeconds is state (declared above) — driven by COUNTDOWN_TICK and the rAF timer.
  const showCountdownOverlay = phase === 'COUNTDOWN' || isCountdownOverlayVisible;
  const isMatchActive = latestMatchSnapshot?.isActive ?? (phase === 'RUNNING');
  const inputLocked = !isMatchActive || !!matchEndingNotice || !!results;
  const waitingRemainingSec = waitingSinceMs ? Math.max(0, Math.ceil((waitingSinceMs + WAITING_TIMEOUT_MS - nowMs) / 1000)) : 40;

  // Countdown display timer: runs a rAF loop that derives the integer seconds
  // from serverStartAt when phase is COUNTDOWN and startAtMs is a valid future
  // timestamp.  COUNTDOWN_TICK messages (handled in the listener above) also
  // set countdownSeconds directly, so early ticks before MATCH_STATE arrives
  // still produce a visible countdown number — fixing the blank-timer race.
  //
  // Using rAF instead of setInterval avoids duplicate-interval bugs caused by
  // React 18 batching and guarantees automatic cleanup via cancelAnimationFrame.
  useEffect(() => {
    if (phase !== 'COUNTDOWN') {
      // Leaving countdown: clear the number; isCountdownOverlayVisible is
      // cleared separately by the GO overlay effect and the MATCH_STATE handler.
      setCountdownSeconds(null);
      countdownEnteredAtRef.current = null;
      return;
    }

    countdownEnteredAtRef.current = Date.now();
    countdownPhaseRef.current = "active";

    if (startAtMs !== null && startAtMs > Date.now()) {
      let rafId: number;
      let lastRendered = -1;
      const tick = () => {
        const remaining = Math.ceil((startAtMs - Date.now()) / 1000);
        const capped = Math.min(3, Math.max(0, remaining));
        if (capped !== lastRendered) {
          lastRendered = capped;
          setCountdownSeconds(capped);
        }
        rafId = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(rafId);
    }
    // No valid future startAtMs — countdownSeconds driven by COUNTDOWN_TICK only.
    return undefined;
  }, [phase, startAtMs]);

  // C3 fix: If COUNTDOWN persists > 15 seconds without transitioning to
  // RUNNING, abort and redirect back to queue.
  // NC5 fix: Read the snapshot-driven status (via getLatestMatchSnapshot, which
  // reads a live ref) rather than phaseRef, so we never abort when the snapshot
  // already shows RUNNING but local phase state lags.
  useEffect(() => {
    if (phase !== 'COUNTDOWN') return;
    const timer = window.setTimeout(() => {
      const snapshotStatus = getLatestMatchSnapshot(activeMatchId)?.status ?? phaseRef.current;
      if (snapshotStatus !== "RUNNING" && snapshotStatus !== "FINISHED") {
        router.push("/pvp/1v1");
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
   }, [phase, getLatestMatchSnapshot, activeMatchId, router]);

  // Client-side countdown freeze watchdog:
  // When countdownSeconds reaches 0 and phase is still COUNTDOWN
  // (i.e. the RUNNING server message has not arrived), send a MATCH_SYNC_REQUEST
  // to ask the gateway to either activate the match or replay MATCH_STATE.
  // We allow up to 3 attempts per countdown phase (500 ms apart) before giving up.
  useEffect(() => {
    if (phase !== 'COUNTDOWN') {
      // Reset counter whenever we leave the COUNTDOWN phase.
      syncRequestCountRef.current = 0;
      return;
    }
    if (countdownSeconds !== 0) return;
    if (syncRequestCountRef.current >= 3) return;

    const attempt = syncRequestCountRef.current;
    const delayMs = attempt * 500;
    const timer = window.setTimeout(() => {
      // Re-check: if the match already advanced while we were waiting, skip.
      const snapshotStatus = getLatestMatchSnapshot(activeMatchId)?.status ?? phaseRef.current;
      if (snapshotStatus === "RUNNING" || snapshotStatus === "FINISHED") return;

      syncRequestCountRef.current += 1;
      send({ type: "MATCH_SYNC_REQUEST", payload: { matchId: activeMatchId } });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [countdownSeconds, phase, send, activeMatchId, getLatestMatchSnapshot]);

  // Redirect back to queue when the opponent-connecting countdown expires
  useEffect(() => {
    if (!isWaitingForOpponent) return;
    if (waitingRemainingSec > 0) return;
    router.push("/pvp/1v1");
  }, [isWaitingForOpponent, waitingRemainingSec, router]);

  const byId = useMemo(() => {
    const map = new Map<string, { userId: string; username: string; slot: number }>();
    for (const p of players) map.set(p.userId, { userId: p.userId, username: p.username, slot: p.slot });
    return map;
  }, [players]);

  const remoteCarets = useMemo(() => {
    return Object.entries(carets)
      .filter(([uid]) => uid !== user?.userId)
      .map(([uid, caretIndex]) => {
        const p = byId.get(uid);
        if (!p) return null;
        const pos = remoteCaretPositions[uid] ?? { x: 16, y: 18 };
        return { userId: uid, username: p.username, slot: p.slot, caretIndex, pos };
      })
      .filter(Boolean) as Array<{ userId: string; username: string; slot: number; caretIndex: number; pos: { x: number; y: number } }>;
  }, [byId, carets, remoteCaretPositions, user?.userId]);

  // Ref storing the caret indices from the previous layout effect run.
  // When no remote index has changed we skip all DOM measurements entirely.
  const prevCaretsRef = useRef<Record<string, number>>({});
  const lastRemoteCaretCalcAtRef = useRef(0);
  useLayoutEffect(() => {
    if (!text) return;
    const meId = user?.userId;

    // Short-circuit: skip expensive DOM reads if no remote index changed.
    let hasChanged = false;
    for (const [uid, idx] of Object.entries(carets)) {
      if (uid === meId) continue;
      if (prevCaretsRef.current[uid] !== idx) {
        hasChanged = true;
        break;
      }
    }
    if (!hasChanged) return;

    const now = performance.now();
    if (now - lastRemoteCaretCalcAtRef.current < 50) return;
    lastRemoteCaretCalcAtRef.current = now;

    const raf = window.requestAnimationFrame(() => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const [uid, caretIndex] of Object.entries(carets)) {
        if (uid === meId) continue;
        next[uid] = getCaretPositionForIndex({
          textRefs: pvpActionsRef.current?.getTextRefs().current ?? [],
          caretIndex,
          fallback: { x: 16, y: 18 },
        });
      }
      prevCaretsRef.current = { ...carets };
      setRemoteCaretPositions(next);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [carets, pvpActionsRef, text, user?.userId]);

  const meId = user?.userId ?? null;
  const canRematch = players.length === 2 && roomCode == null;
  const opponent = useMemo(() => {
    if (!meId) return null;
    return players.find((p) => p.userId !== meId) ?? null;
  }, [meId, players]);

  // Deferred chart data: computed asynchronously after results arrive so the
  // results overlay renders immediately without blocking on history traversal.
  const [chartData, setChartData] = useState<Array<{ time: string; meWpm: number; opponentWpm: number }>>([]);
  useEffect(() => {
    if (!results || !meId || !opponent || !startAtMs) {
      setChartData([]);
      return;
    }
    const meHist = wpmHistoryRef.current[meId] ?? [];
    const opHist = wpmHistoryRef.current[opponent.userId] ?? [];
    if (!meHist.length && !opHist.length) {
      setChartData([]);
      return;
    }
    const id = window.setTimeout(() => {
      const endMs = Math.max(
        meHist.length ? meHist[meHist.length - 1]!.tMs : startAtMs,
        opHist.length ? opHist[opHist.length - 1]!.tMs : startAtMs,
      );
      const stepMs = 1000;
      const points: Array<{ time: string; meWpm: number; opponentWpm: number }> = [];
      let i = 0;
      let j = 0;
      let meWpm = 0;
      let opWpm = 0;
      for (let t = startAtMs; t <= endMs; t += stepMs) {
        while (i < meHist.length && meHist[i]!.tMs <= t) { meWpm = meHist[i]!.wpm; i += 1; }
        while (j < opHist.length && opHist[j]!.tMs <= t) { opWpm = opHist[j]!.wpm; j += 1; }
        const s = Math.max(0, Math.floor((t - startAtMs) / 1000));
        points.push({ time: `${s}s`, meWpm, opponentWpm: opWpm });
      }
      setChartData(points);
    }, 0);
    return () => window.clearTimeout(id);
  }, [results, meId, opponent, startAtMs]);

  // Stable memoized prop bag for <TypingTest>: prevents re-renders of the
  // heavy TypingTest subtree whenever unrelated state (e.g. nowMs) changes.
  const typingTestExtraProps = useMemo(() => ({
    inputDisabled: inputLocked,
    fontSize: "text-2xl" as const,
    lineHeight: "leading-10" as const,
    font: getTypingFontClass(settings.typingLanguage),
    optimizePerformance: true as const,
    caretHeight: "h-7" as const,
    caretColorClassName: slotToColor(byId.get(user?.userId ?? "")?.slot ?? 0),
    onWpmChange: setMyWpm,
  }), [inputLocked, settings.typingLanguage, byId, user?.userId]);

  const onRequestRematch = () => {
    setRematchDeclinedReason(null);
    setRematchOfferFromUserId(null);
    send({ type: "REMATCH_REQUEST", payload: { matchId: activeMatchId } });
  };

  const onAcceptRematch = () => {
    setRematchDeclinedReason(null);
    setRematchOfferFromUserId(null);
    send({ type: "REMATCH_RESPONSE", payload: { matchId: activeMatchId, accept: true } });
  };

  const onDeclineRematch = () => {
    setRematchOfferFromUserId(null);
    send({ type: "REMATCH_RESPONSE", payload: { matchId: activeMatchId, accept: false } });
  };

  // ── Render: completely rebuilt UI with zero cards ───────────────────────
  if (matchRecoveryFailed && !results) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-12 text-center space-y-6">
        <div className="space-y-3">
          <Swords className="mx-auto h-8 w-8 text-rose-400/50" />
          <h2 className="text-2xl font-bold tracking-tight text-rose-200">
            The duel was interrupted
          </h2>
          <p className="text-sm text-white/60 max-w-md mx-auto">
            Fear not — your battle record remains. Return to the arena gate when ready.
          </p>
        </div>
        <Button
          variant="secondary"
          className="rounded-full px-6"
          onClick={() => router.push("/pvp/1v1")}
        >
          Return to the Arena Gate
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* ── WPM display ── */}
      <div className="flex items-center justify-between border-b border-gray-600/30 pb-2 font-mono">
        <div className="text-gray-400 text-lg">
          WPM: <span className="font-bold text-white">{myWpm}</span>
        </div>
        {opponent && opponentWpm !== null && (
          <div className="text-gray-400 text-lg">
            {opponent.username}: <span className="font-bold text-white">{opponentWpm}</span> WPM
          </div>
        )}
      </div>

      {/* ── Notice without any card ── */}
      {matchEndingNotice && (
        <div className="flex items-center gap-2 text-sm text-amber-300/90 font-medium">
          <Timer className="h-4 w-4" />
          {matchEndingNotice}
        </div>
      )}

      {/* ── Opponent waiting: clean text row, no container ── */}
      {isWaitingForOpponent ? (
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-sky-100">
                Rival approaching the arena…
              </p>
              <p className="text-xs text-sky-200/80">
                Gates close if they tarry too long.
              </p>
            </div>
          </div>
          <span className="text-xs tabular-nums text-sky-200">
            {waitingRemainingSec}s
          </span>
        </div>
      ) : (
        // ── Main game area (no extra wrappers) ──
        <div className="relative">
          <TypingTest
            key={textId ?? activeMatchId}
            {...pvpTypingTestProps}
            {...typingTestExtraProps}
          >
            {remoteCarets.map((c) => (
              <MemoizedCaret
                key={c.userId}
                caretPosition={c.pos}
                caretHeight="h-7"
                colorClassName={slotToColor(c.slot)}
                className="opacity-90"
              />
            ))}
          </TypingTest>

          {/* ── Countdown overlay: pure centered text, no border/shadow ── */}
          <AnimatePresence>
            {showCountdownOverlay || showGoOverlay ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
              >
                {showGoOverlay ? (
                  <div key="go" className="text-center select-none">
                    <div className="text-9xl font-black leading-none text-emerald-400 drop-shadow-[0_0_48px_rgba(52,211,153,0.7)]">
                      CHARGE!
                    </div>
                  </div>
                ) : (
                  <div className="text-center select-none">
                    {countdownSeconds !== null && countdownSeconds > 0 ? (
                      <div className="text-xs uppercase tracking-[0.24em] text-sky-300 font-medium">
                        Clash begins in
                      </div>
                    ) : null}
                    <div
                      key={countdownSeconds ?? "syncing"}
                      className="mt-2 text-9xl font-black leading-none text-white drop-shadow-[0_0_32px_rgba(125,211,252,0.5)] animate-countdown-pop"
                    >
                      {countdownSeconds !== null && countdownSeconds > 0
                        ? countdownSeconds
                        : countdownSeconds === 0
                          ? <span className="text-5xl font-black text-emerald-300">GO!</span>
                          : <span className="text-5xl animate-pulse text-sky-200">Brace yourself</span>}
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-wider text-sky-400">
                    Locked
                    </div>
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      )}

      {/* ── Results overlay: now uses immersive, card‑free design ── */}
      {results ? (
        <PvpResultsOverlay
          open
          primaryActionLabel={roomCode ? "Race again" : "Find a new typer"}
          placements={results.placements}
          ratingChanges={results.ratingChanges}
          chartData={chartData}
          meUserId={meId}
          opponentName={opponent?.username ?? "Opponent"}
          canRematch={canRematch}
          rematchOfferFromUserId={rematchOfferFromUserId}
          rematchAcceptedUserIds={rematchAcceptedUserIds}
          rematchDeclinedReason={rematchDeclinedReason}
          isSearchingNewOpponent={isSearchingNewOpponent}
          onRequestRematch={onRequestRematch}
          onAcceptRematch={onAcceptRematch}
          onDeclineRematch={onDeclineRematch}
          onFindNewOpponent={() => {
            setIsSearchingNewOpponent(true);
            send({ type: "QUEUE_JOIN", payload: {} });
          }}
        />
      ) : null}
    </div>
  );
}