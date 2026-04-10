import React from "react";
import { act, render, screen } from "@testing-library/react";

import Pvp1v1Client from "../Pvp1v1Client";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";

const pushMock = jest.fn();
const replaceMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

jest.mock("@/features/pvp/client/pvp-error-utils", () => ({
  usePvpErrorAlert: jest.fn(),
}));

jest.mock("@/features/pvp/client/usePvpSocket", () => ({
  usePvpSocket: jest.fn(),
}));

type Listener = (message: Record<string, unknown>) => void;

const usePvpSocketMock = usePvpSocket as jest.Mock;
const sendMock = jest.fn();

let listeners: Listener[] = [];

async function emitMessage(message: Record<string, unknown>) {
  await act(async () => {
    for (const listener of listeners) {
      listener(message);
    }
  });
}

describe("Pvp1v1Client", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners = [];
    pushMock.mockClear();
    replaceMock.mockClear();
    sendMock.mockClear();
    // Mock fetch (not available as spyable in jsdom without prior definition)
    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ currentStreak: 0, level: 1 }),
      } as unknown as Response),
    });
    usePvpSocketMock.mockImplementation(() => ({
      status: "ready",
      error: null,
      user: { userId: "u1", username: "me", avatar: null },
      send: sendMock,
      addListener: (listener: Listener) => {
        listeners.push(listener);
        return () => {
          listeners = listeners.filter((entry) => entry !== listener);
        };
      },
      reconnect: jest.fn(),
      refreshUserSnapshot: jest.fn(),
      connectionPhase: { kind: "ready" },
      isOffline: false,
      circuitBreakerActiveUntil: null,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("keeps the queue page loading-only after MATCH_FOUND and redirects to the match page", async () => {
    render(<Pvp1v1Client />);

    await emitMessage({
      type: "QUEUE_STATUS",
      payload: { status: "SEARCHING" },
    });

    expect(screen.getByText("Hunting for a worthy rival...")).toBeInTheDocument();
    expect(screen.queryByText("Match starts in")).not.toBeInTheDocument();

    await emitMessage({
      type: "MATCH_FOUND",
      payload: {
        matchId: "match-1",
        textSnapshot: "sample text",
        textId: "text-1",
        inputNonce: "nonce-1",
        serverStartAt: new Date("2026-03-24T12:00:03.000Z").toISOString(),
        players: [
          { userId: "u1", username: "me", avatar: null, slot: 0 },
          { userId: "u2", username: "them", avatar: null, slot: 1, averageWpm: 92 },
        ],
      },
    });

    // After MATCH_FOUND the pre-match status bar appears with the first label
    expect(screen.getByText("Syncing Players")).toBeInTheDocument();
    expect(screen.queryByText("Match starts in")).not.toBeInTheDocument();
    // Router redirect happens after the 4.6 s animation completes
    expect(pushMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    expect(pushMock).toHaveBeenCalledWith("/pvp/match/match-1");
  });
});