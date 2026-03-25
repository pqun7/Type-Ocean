"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import type { ClientMessage, ServerMessage } from "@/features/pvp/client/types";
import { Button } from "@/components/ui/button";

import TypingTest from "@/components/TypingTest/TypingTest";
import Caret from "@/components/TypingTest/Caret";
import usePvpTyping from "@/features/pvp/client/usePvpTyping";

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

export default function PvpMatchClient({ matchId }: { matchId: string }) {
  const WAITING_TIMEOUT_MS = 40_000;
  const router = useRouter();
  const { status, user, send, addListener, getLatestMatchSnapshot, connectionPhase } = usePvpSocket();

  // Active match ID for in-place rematch — starts equal to the prop,
  // but can be swapped without navigation when a rematch starts.
  const [activeMatchId, setActiveMatchId] = useState(matchId);
  const activeMatchIdRef = useRef(matchId);

  const [text, setText] = useState<string>("");
  const [textId, setTextId] = useState<string | null>(null);
  const [serverStartAt, setServerStartAt] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [matchStatus, setMatchStatus] = useState<string>("PENDING");
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
  const previousMatchStatusRef = useRef(matchStatus);
  /** Local countdown integer: 3 → 2 → 1 → 0. Driven by 1-second interval. */
  const [localCountdown, setLocalCountdown] = useState<number | null>(null);
  /** Timestamp when we entered COUNTDOWN state (for timeout detection). */
  const countdownEnteredAtRef = useRef<number | null>(null);

  const [results, setResults] = useState<null | {
    placements: Array<{ position: number; userId: string; username: string; wpm: number; accuracy: number; errors: number; timeMs: number }>;
    ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }>;
  }>(null);
  const statusRef = useRef(status);
  const matchStatusRef = useRef(matchStatus);
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
    (input: string, _graphemesTyped: number, isComplete: boolean) => {
      if (matchStatusRef.current !== "RUNNING") return;

      const now = Date.now();
      const canSend = now - lastSentAtRef.current >= 60;

      if (canSend || isComplete) {
        if (canSend) {
          lastSentAtRef.current = now;
          seqRef.current += 1;
          sendOrBuffer({
            type: "INPUT_UPDATE",
            payload: { matchId: activeMatchIdRef.current, input, seq: seqRef.current, clientTs: now, inputNonce: inputNonce ?? undefined },
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
    if (results !== null || matchStatus === "FINISHED" || matchStatus === "ENDING") return;
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
  }, [connectionPhase.kind, results, matchStatus]);

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
    setMatchStatus("PENDING");
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
    setLocalCountdown(null);
    setShowGoOverlay(false);
    pendingInputBufferRef.current = [];
    connectionDroppedAtRef.current = null;
  }, []);

  // Reset per-match state when active match changes.
  useEffect(() => {
    resetMatchState();
  }, [activeMatchId, resetMatchState]);

  const isWaitingForOpponent = hasReceivedMatchState && matchStatus === "PENDING" && players.length < 2 && !results;

  // Refresh nowMs for the waiting-for-opponent timer.
  useEffect(() => {
    if (!isWaitingForOpponent) return;

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [isWaitingForOpponent]);

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
    matchStatusRef.current = matchStatus;
  }, [matchStatus]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    waitingSinceMsRef.current = waitingSinceMs;
  }, [waitingSinceMs]);

  const effectiveMatchStatus = latestMatchSnapshot?.status ?? matchStatus;

  useEffect(() => {
    const previousStatus = previousMatchStatusRef.current;
    if (previousStatus === "COUNTDOWN" && effectiveMatchStatus === "RUNNING") {
      setShowGoOverlay(true);
      const overlayTimer = window.setTimeout(() => setShowGoOverlay(false), 700);
      const focusTimer = window.setTimeout(() => pvpActionsRef.current?.focus(), 50);
      previousMatchStatusRef.current = effectiveMatchStatus;
      return () => {
        window.clearTimeout(overlayTimer);
        window.clearTimeout(focusTimer);
      };
    }

    previousMatchStatusRef.current = effectiveMatchStatus;
    return undefined;
  }, [effectiveMatchStatus, pvpActionsRef]);

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

    setMatchStatus(nextState.status);

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

    if (nextState.localServerInput !== null) {
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
      if (matchStatusRef.current === "FINISHED" || matchStatusRef.current === "ENDING") return;
      send({ type: "MATCH_LEAVE", payload: { matchId: activeMatchIdRef.current } });
    };
  }, [activeMatchId, send]);

  useEffect(() => {
    return addListener((m) => {
      const currentMatchId = activeMatchIdRef.current;

      // In-place rematch: swap active match without navigation.
      if (m.type === "MATCH_FOUND" && m.payload.matchId !== currentMatchId) {
        activeMatchIdRef.current = m.payload.matchId;
        resetMatchState();
        setActiveMatchId(m.payload.matchId);
        window.history.replaceState(null, "", `/pvp/match/${m.payload.matchId}`);
        return;
      }

      // Server-push countdown tick — drives the countdown display directly.
      if (m.type === "COUNTDOWN_TICK" && m.payload.matchId === currentMatchId) {
        setLocalCountdown(m.payload.remainingSeconds);
        return;
      }

      if (m.type === "MATCH_STATE" && m.payload.matchId === currentMatchId) {
        applyMatchStateSnapshot(m.payload);
      }
      if (m.type === "PROGRESS" && m.payload.matchId === currentMatchId) {
        applyProgressSnapshot(m.payload);
      }
      if (m.type === "MATCH_ENDED" && m.payload.matchId === currentMatchId) {
        setMatchStatus("ENDING");
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
  const startAtMs = effectiveServerStartAt ? new Date(effectiveServerStartAt).getTime() : null;
  // C1 fix: Use the local countdown integer instead of raw clock-skew-vulnerable computation.
  const countdownSeconds = effectiveMatchStatus === "COUNTDOWN" ? localCountdown : null;
  const showCountdownOverlay = latestMatchSnapshot?.isCountdown ?? (effectiveMatchStatus === "COUNTDOWN");
  const isMatchActive = latestMatchSnapshot?.isActive ?? (effectiveMatchStatus === "RUNNING");
  const inputLocked = !isMatchActive || !!matchEndingNotice || !!results;
  const waitingRemainingSec = waitingSinceMs ? Math.max(0, Math.ceil((waitingSinceMs + WAITING_TIMEOUT_MS - nowMs) / 1000)) : 40;

  // Server-push countdown: localCountdown is now driven exclusively by
  // COUNTDOWN_TICK messages from the server. Clear it when leaving COUNTDOWN.
  useEffect(() => {
    if (effectiveMatchStatus === "COUNTDOWN") {
      countdownEnteredAtRef.current = Date.now();
    } else {
      setLocalCountdown(null);
      countdownEnteredAtRef.current = null;
    }
  }, [effectiveMatchStatus]);

  // C3 fix: If COUNTDOWN persists > 15 seconds without transitioning to
  // RUNNING, abort and redirect back to queue.
  // NC5 fix: Read the snapshot-driven status (via getLatestMatchSnapshot, which
  // reads a live ref) rather than the React-state-backed matchStatusRef, so we
  // never abort when the snapshot already shows RUNNING but local state lags.
  useEffect(() => {
    if (effectiveMatchStatus !== "COUNTDOWN") return;
    const timer = window.setTimeout(() => {
      const snapshotStatus = getLatestMatchSnapshot(activeMatchId)?.status ?? matchStatusRef.current;
      if (snapshotStatus !== "RUNNING" && snapshotStatus !== "FINISHED") {
        router.push("/pvp/1v1");
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [effectiveMatchStatus, getLatestMatchSnapshot, activeMatchId, matchStatusRef, router]);

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

  const lastRemoteCaretCalcAtRef = useRef(0);
  useLayoutEffect(() => {
    if (!text) return;
    const meId = user?.userId;
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

  const chartData = useMemo(() => {
    if (!results) return [];
    if (!meId || !opponent || !startAtMs) return [];

    const meHist = wpmHistoryRef.current[meId] ?? [];
    const opHist = wpmHistoryRef.current[opponent.userId] ?? [];
    if (!meHist.length && !opHist.length) return [];

    const endMs = Math.max(
      meHist.length ? meHist[meHist.length - 1]!.tMs : startAtMs,
      opHist.length ? opHist[opHist.length - 1]!.tMs : startAtMs
    );

    const stepMs = 1000;
    const points: Array<{ time: string; meWpm: number; opponentWpm: number }> = [];

    let i = 0;
    let j = 0;
    let meWpm = 0;
    let opWpm = 0;

    for (let t = startAtMs; t <= endMs; t += stepMs) {
      while (i < meHist.length && meHist[i]!.tMs <= t) {
        meWpm = meHist[i]!.wpm;
        i += 1;
      }
      while (j < opHist.length && opHist[j]!.tMs <= t) {
        opWpm = opHist[j]!.wpm;
        j += 1;
      }
      const s = Math.max(0, Math.floor((t - startAtMs) / 1000));
      points.push({ time: `${s}s`, meWpm, opponentWpm: opWpm });
    }

    return points;
  }, [meId, opponent, results, startAtMs]);

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

  if (matchRecoveryFailed && !results) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="rounded-xl border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.5)] p-8 text-center space-y-4">
          <div className="text-[#E0E7FF] text-xl font-semibold">Match ended unexpectedly</div>
          <div className="text-[#B5CAE2] text-sm">
            Your results may have been saved. Return to the queue to play again.
          </div>
          <Button onClick={() => router.push("/pvp/1v1")}>Back to queue</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[#E0E7FF] text-xl font-semibold">Match</div>
          <div className="text-sm text-[#8A8FB5]">
            {effectiveMatchStatus}
            {textId ? ` · Text: ${textId}` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => pvpActionsRef.current?.focus()}>
            Focus
          </Button>
        </div>
      </div>

      {matchEndingNotice ? <div className="text-sm text-amber-300">{matchEndingNotice}</div> : null}

      {isWaitingForOpponent ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(125,211,252,0.2)] bg-[rgba(56,189,248,0.08)] px-4 py-3 text-sky-100">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
            <div>
              <div className="text-sm font-medium">Opponent is connecting... please wait.</div>
              <div className="text-xs text-sky-200">Match will be cancelled if they do not connect in time.</div>
            </div>
          </div>
          <div className="rounded-md border border-[rgba(125,211,252,0.2)] px-2 py-1 text-xs text-sky-200">{waitingRemainingSec}s</div>
        </div>
      ) : (
        <TypingTest
          key={textId ?? activeMatchId}
          {...pvpTypingTestProps}
          inputDisabled={inputLocked}
          fontSize="text-2xl"
          lineHeight="leading-10"
          font="font-mono"
          optimizePerformance
          caretHeight="h-7"
          caretColorClassName={slotToColor(byId.get(user?.userId ?? "")?.slot ?? 0)}
        >
          {/* Countdown / GO overlay */}
          {showCountdownOverlay || showGoOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-[rgba(125,211,252,0.22)] bg-black/40 backdrop-blur-sm">
              {showGoOverlay ? (
                <div key="go" className="text-center select-none animate-countdown-pop">
                  <div className="text-9xl font-bold leading-none text-emerald-400 drop-shadow-[0_0_48px_rgba(52,211,153,0.7)]">
                    GO!
                  </div>
                </div>
              ) : (
                <div className="text-center select-none">
                  {/* NC2 fix: hide label at 0 to avoid jarring "Match starts in 0" */}
                  {countdownSeconds !== null && countdownSeconds > 0 ? (
                    <div className="text-xs uppercase tracking-[0.24em] text-sky-300 font-medium">Match starts in</div>
                  ) : null}
                  <div
                    key={countdownSeconds ?? "syncing"}
                    className="mt-2 text-9xl font-bold leading-none text-white drop-shadow-[0_0_32px_rgba(125,211,252,0.5)] animate-countdown-pop"
                  >
                    {/* NC3 fix: don't show "GO!" at 0 in the white overlay — the
                        green showGoOverlay already handles the transition, so showing
                        "GO!" here would cause a double-flash. */}
                    {countdownSeconds !== null && countdownSeconds > 0 ? countdownSeconds : null}
                  </div>
                  <div className="mt-3 text-xs uppercase tracking-wider text-sky-400">Keyboard locked</div>
                </div>
              )}
            </div>
          ) : null}

          {/* Remote player carets */}
          {remoteCarets.map((c) => (
            <Caret
              key={c.userId}
              caretPosition={c.pos}
              caretHeight="h-7"
              colorClassName={slotToColor(c.slot)}
              className="opacity-90"
            />
          ))}
        </TypingTest>
      )}

      {results ? (
        <PvpResultsOverlay
          open
          primaryActionLabel={roomCode ? "Play Again" : "Find new opponent"}
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
