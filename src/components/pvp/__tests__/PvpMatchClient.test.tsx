import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import PvpMatchClient from "../PvpMatchClient";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { useLevel } from "@/features/level/hooks/useLevel";
import type { ClientMessage } from "@/features/pvp/client/types";

jest.mock("framer-motion", () => {
  const React = require("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target: Record<string, unknown>, tag: string) =>
          React.forwardRef(
            ({ children, ...props }: React.HTMLProps<HTMLElement>, ref: React.Ref<HTMLElement>) =>
              React.createElement(tag, { ...props, ref }, children),
          ),
      },
    ),
  };
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

const focusMock = jest.fn();
const syncInputMock = jest.fn();
const stableActionsRef = {
  current: {
    focus: focusMock,
    syncInput: syncInputMock,
    getTextRefs: () => ({ current: [] }),
  },
};

jest.mock("@/features/pvp/client/usePvpTyping", () => ({
  __esModule: true,
  default: (params: { controlledText: string; onInputValidated: (input: string, graphemesTyped: number, isComplete: boolean) => void }) => {
    return {
      actionsRef: stableActionsRef,
      typingTestProps: {
        controlledText: params.controlledText,
        onInputValidated: params.onInputValidated,
        mode: "strict" as const,
        skipSessionTracking: true as const,
        actionsRef: stableActionsRef,
      },
    };
  },
}));

jest.mock("@/components/TypingTest/TypingTest", () => ({
  __esModule: true,
  default: (props: React.PropsWithChildren<{ inputDisabled?: boolean; onInputValidated?: (input: string, graphemesTyped: number, isComplete: boolean) => void }>) => (
    <div data-testid="typing-test">
      <button
        data-testid="typing-input"
        disabled={Boolean(props.inputDisabled)}
        type="button"
        onClick={() => props.onInputValidated?.("abc", 3, false)}
      >
        typing input
      </button>
      {props.children}
    </div>
  ),
}));

jest.mock("@/components/TypingTest/Caret", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/pvp/PvpResultsOverlay", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/features/typing/hooks/useCaret", () => ({
  getCaretPositionForIndex: () => ({ x: 0, y: 0 }),
}));

jest.mock("@/features/pvp/client/usePvpSocket", () => ({
  usePvpSocket: jest.fn(),
}));

jest.mock("@/features/level/hooks/useLevel", () => ({
  useLevel: jest.fn(),
}));

type Listener = (message: Record<string, unknown>) => void;

type Snapshot = {
  matchId: string;
  textId: string | null;
  inputNonce: string | null;
  serverStartAt: string;
  roomCode: string | null;
  revision: number;
  status: "COUNTDOWN" | "RUNNING" | "PENDING" | "ENDING" | "FINISHED" | "ABORTED";
  isCountdown: boolean;
  isActive: boolean;
  isTerminal: boolean;
};

const sendMock = jest.fn<boolean, [ClientMessage]>(() => true);
const usePvpSocketMock = usePvpSocket as jest.Mock;
const useLevelMock = useLevel as jest.Mock;

let listeners: Listener[] = [];
let latestSnapshot: Snapshot | null = null;
let socketStatus: "ready" | "error" = "ready";
let connectionPhase:
  | { kind: "ready" }
  | { kind: "reconnecting"; attempt: number; nextRetryAt: number }
  | { kind: "connecting" } = { kind: "ready" };
let currentSendResult = true;

function buildMatchState(params: {
  status: Snapshot["status"];
  revision: number;
  serverStartAt?: string;
  caretIndex?: number;
}) {
  return {
    type: "MATCH_STATE",
    payload: {
      matchId: "match-1",
      revision: params.revision,
      roomCode: null,
      status: params.status,
      textSnapshot: "sample text",
      textId: "text-1",
      inputNonce: "nonce-1",
      serverStartAt: params.serverStartAt ?? new Date("2026-03-24T12:00:03.000Z").toISOString(),
      snapshotAt: new Date("2026-03-24T12:00:00.000Z").toISOString(),
      players: [
        {
          userId: "u1",
          username: "me",
          avatar: null,
          slot: 0,
          caretIndex: params.caretIndex ?? 0,
          wpm: 0,
          accuracy: 100,
          errors: 0,
          finishedAt: null,
        },
        {
          userId: "u2",
          username: "them",
          avatar: null,
          slot: 1,
          caretIndex: 0,
          wpm: 0,
          accuracy: 100,
          errors: 0,
          finishedAt: null,
        },
      ],
    },
  } as const;
}

function buildProgress(params: {
  revision: number;
  userId?: string;
  status?: Snapshot["status"];
  caretIndex: number;
  wpm?: number;
  serverNowMs?: number;
}) {
  return {
    type: "PROGRESS",
    payload: {
      matchId: "match-1",
      revision: params.revision,
      status: params.status ?? "RUNNING",
      userId: params.userId ?? "u1",
      caretIndex: params.caretIndex,
      wpm: params.wpm ?? 72,
      accuracy: 100,
      errors: 0,
      finishedAt: null,
      serverNowMs: params.serverNowMs ?? Date.now(),
    },
  } as const;
}

function updateSnapshotFromMatchState(message: ReturnType<typeof buildMatchState>) {
  latestSnapshot = {
    matchId: message.payload.matchId,
    textId: message.payload.textId ?? null,
    inputNonce: message.payload.inputNonce ?? null,
    serverStartAt: message.payload.serverStartAt,
    roomCode: message.payload.roomCode ?? null,
    revision: message.payload.revision,
    status: message.payload.status as Snapshot["status"],
    isCountdown: message.payload.status === "COUNTDOWN",
    isActive: message.payload.status === "RUNNING",
    isTerminal: ["ENDING", "FINISHED", "ABORTED"].includes(message.payload.status),
  };
}

async function emitMatchState(message: ReturnType<typeof buildMatchState>) {
  updateSnapshotFromMatchState(message);
  await act(async () => {
    for (const listener of listeners) {
      listener(message as unknown as Record<string, unknown>);
    }
  });
}

async function emitProgress(message: ReturnType<typeof buildProgress>) {
  await act(async () => {
    for (const listener of listeners) {
      listener(message as unknown as Record<string, unknown>);
    }
  });
}

function getInputUpdateCalls() {
  return sendMock.mock.calls.filter(([message]) => message.type === "INPUT_UPDATE");
}

describe("PvpMatchClient", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    listeners = [];
    latestSnapshot = null;
    socketStatus = "ready";
    connectionPhase = { kind: "ready" };
    currentSendResult = true;
    sendMock.mockClear();
    sendMock.mockImplementation(() => currentSendResult);
    focusMock.mockClear();
    syncInputMock.mockClear();
    usePvpSocketMock.mockImplementation(() => ({
      status: socketStatus,
      user: { userId: "u1", username: "me", avatar: null },
      send: sendMock,
      addListener: (listener: Listener) => {
        listeners.push(listener);
        return () => {
          listeners = listeners.filter((entry) => entry !== listener);
        };
      },
      getLatestMatchSnapshot: () => latestSnapshot,
      connectionPhase,
    }));
    useLevelMock.mockReturnValue({
      addXPMessage: jest.fn(),
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      writable: true,
      value: (handle: number) => window.clearTimeout(handle),
    });
  });

  it("keeps input disabled before active and enables it after RUNNING", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1 }));
    // Server-push countdown: emit a tick so the countdown overlay shows the label.
    await act(async () => {
      for (const listener of listeners) {
        listener({ type: "COUNTDOWN_TICK", payload: { matchId: "match-1", remainingSeconds: 3 } });
      }
    });
    expect(screen.getByTestId("typing-input")).toBeDisabled();
    expect(screen.getByText("Clash begins in")).toBeInTheDocument();

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2 }));
    expect(screen.getByTestId("typing-input")).not.toBeDisabled();
  });

  it("shows the GO overlay exactly once on the authoritative countdown-to-running transition", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1 }));
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2 }));
    expect(screen.getAllByText("CHARGE!")).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(750);
    });
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 3 }));
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();
  });

  it("stays locked when reconnecting during countdown until RUNNING arrives", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1 }));
    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 2 }));

    expect(screen.getByTestId("typing-input")).toBeDisabled();
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();
  });

  it("does not unlock at countdown zero on reconnect until the server sends RUNNING", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(
      buildMatchState({
        status: "COUNTDOWN",
        revision: 1,
        serverStartAt: new Date("2026-03-24T11:59:59.000Z").toISOString(),
      }),
    );

    expect(screen.getByTestId("typing-input")).toBeDisabled();
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2 }));
    expect(screen.getByTestId("typing-input")).not.toBeDisabled();
    expect(screen.getAllByText("CHARGE!")).toHaveLength(1);
  });

  it("does not replay the GO overlay when reconnecting during the active phase", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1 }));
    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2 }));

    await act(async () => {
      jest.advanceTimersByTime(750);
    });

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 3, caretIndex: 4 }));

    expect(screen.getByTestId("typing-input")).not.toBeDisabled();
    expect(screen.queryByText("CHARGE!")).not.toBeInTheDocument();
  });

  it("flushes buffered input after the connection returns to ready", async () => {
    const { rerender } = render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1 }));
    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2 }));

    socketStatus = "error";
    connectionPhase = { kind: "reconnecting", attempt: 1, nextRetryAt: Date.now() + 1_000 };
    currentSendResult = false;
    rerender(<PvpMatchClient matchId="match-1" />);

    fireEvent.click(screen.getByTestId("typing-input"));

    const bufferedInputCalls = getInputUpdateCalls();
    expect(bufferedInputCalls).toHaveLength(1);

    socketStatus = "ready";
    connectionPhase = { kind: "ready" };
    currentSendResult = true;
    rerender(<PvpMatchClient matchId="match-1" />);

    await act(async () => {});

    const flushedInputCalls = getInputUpdateCalls();
    expect(flushedInputCalls).toHaveLength(2);
    expect(flushedInputCalls[1]?.[0]).toEqual(flushedInputCalls[0]?.[0]);
  });

  it("advances local input when delayed replayed progress arrives after a reconnect snapshot", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 2, caretIndex: 2 }));
    expect(syncInputMock).toHaveBeenCalledWith("sa");

    await emitProgress(buildProgress({ revision: 3, userId: "u1", caretIndex: 4, serverNowMs: 10_000 }));

    expect(syncInputMock).toHaveBeenLastCalledWith("samp");
  });

  it("ignores stale delayed progress replay that arrives after a newer reconnect snapshot", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "RUNNING", revision: 5, caretIndex: 5 }));
    syncInputMock.mockClear();

    await emitProgress(buildProgress({ revision: 4, userId: "u1", caretIndex: 8, serverNowMs: 11_000 }));

    expect(syncInputMock).not.toHaveBeenCalled();
  });

  it("shows Get ready placeholder when countdown has no serverStartAt", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(buildMatchState({ status: "COUNTDOWN", revision: 1, serverStartAt: "" }));

    expect(screen.getByText("Brace yourself")).toBeInTheDocument();
  });

  it("drives countdown values locally from serverStartAt via rAF", async () => {
    jest.setSystemTime(new Date("2026-03-24T12:00:00.000Z"));
    render(<PvpMatchClient matchId="match-1" />);

    await emitMatchState(
      buildMatchState({
        status: "COUNTDOWN",
        revision: 1,
        serverStartAt: new Date("2026-03-24T12:00:03.500Z").toISOString(),
      }),
    );

    expect(screen.getByText("3")).toBeInTheDocument();

    await act(async () => {
      jest.setSystemTime(new Date("2026-03-24T12:00:01.200Z"));
      jest.advanceTimersByTime(1200);
    });
    expect(screen.getByText("2")).toBeInTheDocument();

    await act(async () => {
      jest.setSystemTime(new Date("2026-03-24T12:00:02.200Z"));
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("still shows GO when COUNTDOWN and RUNNING arrive in one batched act", async () => {
    render(<PvpMatchClient matchId="match-1" />);

    const countdown = buildMatchState({ status: "COUNTDOWN", revision: 1 });
    const running = buildMatchState({ status: "RUNNING", revision: 2 });
    updateSnapshotFromMatchState(countdown);
    updateSnapshotFromMatchState(running);

    await act(async () => {
      for (const listener of listeners) {
        listener(countdown as unknown as Record<string, unknown>);
        listener(running as unknown as Record<string, unknown>);
      }
    });

    expect(screen.getAllByText("CHARGE!")).toHaveLength(1);
  });
});