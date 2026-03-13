"use client";

import { ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { Button } from "@/components/ui/button";

import TextDisplay from "@/components/TypingTest/TextDisplay";
import TypingInput from "@/components/TypingTest/TypingInput";
import Caret from "@/components/TypingTest/Caret";

import useCaret, { getCaretPositionForIndex } from "@/features/typing/hooks/useCaret";
import PvpResultsOverlay from "@/components/pvp/PvpResultsOverlay";
import { segmentGraphemes } from "@/features/typing/utils/graphemes";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";

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

export default function PvpMatchClient({ matchId }: { matchId: string }) {
  const WAITING_TIMEOUT_MS = 40_000;
  const router = useRouter();
  const { status, error, user, send, addListener, getMatchTransport } = usePvpSocket();
  usePvpErrorAlert(error);

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

  const [userInput, setUserInput] = useState<string>("");
  const seqRef = useRef(0);
  const revisionRef = useRef(0);
  const lastSentAtRef = useRef(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const { caretPosition, textRefs } = useCaret(userInput, text);

  const targetGraphemeCount = useMemo(() => segmentGraphemes(text).length, [text]);

  const wpmHistoryRef = useRef<Record<string, Array<{ tMs: number; wpm: number }>>>({});
  const lastSampleAtRef = useRef<Record<string, number>>({});

  const [rematchOfferFromUserId, setRematchOfferFromUserId] = useState<string | null>(null);
  const [rematchAcceptedUserIds, setRematchAcceptedUserIds] = useState<string[]>([]);
  const [rematchDeclinedReason, setRematchDeclinedReason] = useState<string | null>(null);
  const [matchEndingNotice, setMatchEndingNotice] = useState<string | null>(null);
  const [waitingSinceMs, setWaitingSinceMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [results, setResults] = useState<null | {
    placements: Array<{ position: number; userId: string; username: string; wpm: number; accuracy: number; errors: number; timeMs: number }>;
    ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }>;
  }>(null);
  const statusRef = useRef(status);
  const matchStatusRef = useRef(matchStatus);
  const resultsRef = useRef(results);
  const inputNonce = getMatchTransport(matchId)?.inputNonce ?? null;

  // Reset per-match state on navigation.
  useEffect(() => {
    setText("");
    setTextId(null);
    setServerStartAt(null);
    setRoomCode(null);
    setMatchStatus("PENDING");
    setPlayers([]);
    setCarets({});
    setRemoteCaretPositions({});
    setUserInput("");
    seqRef.current = 0;
    revisionRef.current = 0;
    lastSentAtRef.current = 0;
    wpmHistoryRef.current = {};
    lastSampleAtRef.current = {};
    setResults(null);
    setRematchOfferFromUserId(null);
    setRematchAcceptedUserIds([]);
    setRematchDeclinedReason(null);
    setMatchEndingNotice(null);
    setWaitingSinceMs(null);
    setNowMs(Date.now());
  }, [matchId]);

  const isWaitingForOpponent = matchStatus === "PENDING" && players.length < 2 && !results;

  useEffect(() => {
    if (!isWaitingForOpponent && matchStatus !== "COUNTDOWN") return;

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [isWaitingForOpponent, matchStatus]);

  useEffect(() => {
    if (status !== "ready") return;
    send({ type: "MATCH_JOIN", payload: { matchId } });
  }, [status, send, matchId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    matchStatusRef.current = matchStatus;
  }, [matchStatus]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    return () => {
      if (statusRef.current !== "ready") return;
      if (resultsRef.current) return;
      if (matchStatusRef.current === "FINISHED" || matchStatusRef.current === "ENDING") return;
      send({ type: "MATCH_LEAVE", payload: { matchId } });
    };
  }, [matchId, send]);

  useEffect(() => {
    return addListener((m) => {
      if (m.type === "MATCH_FOUND" && m.payload.matchId !== matchId) {
        router.push(`/pvp/match/${m.payload.matchId}`);
        return;
      }
      if (m.type === "MATCH_STATE" && m.payload.matchId === matchId) {
        if (m.payload.revision < revisionRef.current) return;
        const shouldFocus = revisionRef.current === 0;
        revisionRef.current = m.payload.revision;
        setText(m.payload.textSnapshot);
        setTextId(m.payload.textId ?? null);
        setServerStartAt(m.payload.serverStartAt);
        setRoomCode(m.payload.roomCode ?? null);
        setMatchStatus(m.payload.status);
        const isStillWaiting = m.payload.status === "PENDING" && m.payload.players.length < 2;
        setWaitingSinceMs((current) => (isStillWaiting ? current ?? Date.now() : null));
        setPlayers(m.payload.players.map((p) => ({ userId: p.userId, username: p.username, avatar: p.avatar, slot: p.slot })));
        const next: Record<string, number> = {};
        for (const p of m.payload.players) next[p.userId] = p.caretIndex;
        setCarets(next);

        const hist = { ...wpmHistoryRef.current };
        const last = { ...lastSampleAtRef.current };
        for (const p of m.payload.players) {
          hist[p.userId] = hist[p.userId] ?? [];
          last[p.userId] = last[p.userId] ?? 0;
        }
        wpmHistoryRef.current = hist;
        lastSampleAtRef.current = last;

        if (shouldFocus) {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
      if (m.type === "PROGRESS" && m.payload.matchId === matchId) {
        if (m.payload.revision <= revisionRef.current) return;
        revisionRef.current = m.payload.revision;
        setMatchStatus(m.payload.status);
        setCarets((prev) => ({ ...prev, [m.payload.userId]: m.payload.caretIndex }));

        const tMs = typeof m.payload.serverNowMs === "number" ? m.payload.serverNowMs : Date.now();
        const lastAt = lastSampleAtRef.current[m.payload.userId] ?? 0;
        if (tMs - lastAt >= 250) {
          lastSampleAtRef.current[m.payload.userId] = tMs;
          const bucket = wpmHistoryRef.current[m.payload.userId] ?? [];
          bucket.push({ tMs, wpm: m.payload.wpm });
          wpmHistoryRef.current[m.payload.userId] = bucket;
        }
      }
      if (m.type === "MATCH_ENDED" && m.payload.matchId === matchId) {
        setMatchStatus("ENDING");
        setMatchEndingNotice(m.payload.message);

        if (m.payload.reason === "no_show") {
          window.setTimeout(() => {
            router.push("/pvp/1v1?cancelled=no_show");
          }, 1200);
        }
      }
      if (m.type === "RESULTS" && m.payload.matchId === matchId) {
        setMatchEndingNotice(null);
        setResults({ placements: m.payload.placements, ratingChanges: m.payload.ratingChanges });
      }

      if (m.type === "REMATCH_OFFER" && m.payload.matchId === matchId) {
        setRematchDeclinedReason(null);
        setRematchOfferFromUserId(m.payload.fromUserId);
      }
      if (m.type === "REMATCH_STATUS" && m.payload.matchId === matchId) {
        setRematchAcceptedUserIds(m.payload.acceptedUserIds);
      }
      if (m.type === "REMATCH_DECLINED" && m.payload.matchId === matchId) {
        setRematchOfferFromUserId(null);
        setRematchAcceptedUserIds([]);
        setRematchDeclinedReason(m.payload.reason ?? "declined");
      }
    });
  }, [addListener, matchId, router]);

  const isError = useMemo(() => {
    if (!text || !userInput) return false;
    const i = userInput.length - 1;
    return i >= 0 && userInput[i] !== text[i];
  }, [text, userInput]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (matchEndingNotice || results) return;
    if (isWaitingForOpponent) return;

    const next = e.target.value;
    setUserInput(next);

    const typed = segmentGraphemes(next).length;

    const now = Date.now();
    if (now - lastSentAtRef.current < 60) return;
    lastSentAtRef.current = now;

    seqRef.current += 1;
    send({ type: "INPUT_UPDATE", payload: { matchId, input: next, seq: seqRef.current, clientTs: now, inputNonce: inputNonce ?? undefined } });

    if (text && targetGraphemeCount > 0 && typed >= targetGraphemeCount) {
      send({ type: "FINISH", payload: { matchId, clientTs: now } });
    }
  };

  const startAtMs = serverStartAt ? new Date(serverStartAt).getTime() : null;
  const countdown = startAtMs && matchStatus === "COUNTDOWN" ? Math.max(0, Math.ceil((startAtMs - nowMs) / 1000)) : null;
  const waitingRemainingSec = waitingSinceMs ? Math.max(0, Math.ceil((waitingSinceMs + WAITING_TIMEOUT_MS - nowMs) / 1000)) : 40;

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
          textRefs: textRefs.current,
          caretIndex,
          fallback: { x: 16, y: 18 },
        });
      }
      setRemoteCaretPositions(next);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [carets, text, user?.userId, textRefs]);

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
    send({ type: "REMATCH_REQUEST", payload: { matchId } });
  };

  const onAcceptRematch = () => {
    setRematchDeclinedReason(null);
    setRematchOfferFromUserId(null);
    send({ type: "REMATCH_RESPONSE", payload: { matchId, accept: true } });
  };

  const onDeclineRematch = () => {
    setRematchOfferFromUserId(null);
    send({ type: "REMATCH_RESPONSE", payload: { matchId, accept: false } });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[#E0E7FF] text-xl font-semibold">Match</div>
          <div className="text-sm text-[#8A8FB5]">
            Status: {status} · {matchStatus}
            {textId ? ` · Text: ${textId}` : ""}
            {countdown != null ? ` · Starts in: ${countdown}s` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => inputRef.current?.focus()}>
            Focus
          </Button>
        </div>
      </div>

      {error ? <div className="text-sm text-amber-300">{error}</div> : null}
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
        <div className="relative w-full p-4">
          <TextDisplay
            text={text}
            userInput={userInput}
            isError={isError}
            textRefs={textRefs}
            fontSize="text-2xl"
            lineHeight="leading-10"
            font="font-mono"
            optimizePerformance
          />

          {/* Local caret */}
          <Caret
            caretPosition={caretPosition}
            caretHeight="h-7"
            colorClassName={slotToColor(byId.get(user?.userId ?? "")?.slot ?? 0)}
          />

          {/* Remote carets */}
          {remoteCarets.map((c) => (
            <Caret
              key={c.userId}
              caretPosition={c.pos}
              caretHeight="h-7"
              colorClassName={slotToColor(c.slot)}
              className="opacity-90"
            />
          ))}

          <TypingInput inputRef={inputRef} userInput={userInput} handleInputChange={onChange} />
        </div>
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
          onRequestRematch={onRequestRematch}
          onAcceptRematch={onAcceptRematch}
          onDeclineRematch={onDeclineRematch}
          onFindNewOpponent={() => router.push(roomCode ? `/pvp/room/${roomCode}` : "/pvp/1v1")}
        />
      ) : null}
    </div>
  );
}
