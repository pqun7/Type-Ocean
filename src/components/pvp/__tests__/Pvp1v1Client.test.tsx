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
    listeners = [];
    pushMock.mockClear();
    replaceMock.mockClear();
    sendMock.mockClear();
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
      connectionPhase: { kind: "ready" },
      isOffline: false,
      circuitBreakerActiveUntil: null,
    }));
  });

  it("keeps the queue page loading-only after MATCH_FOUND and redirects to the match page", async () => {
    render(<Pvp1v1Client />);

    await emitMessage({
      type: "QUEUE_STATUS",
      payload: { status: "SEARCHING" },
    });

    expect(screen.getByText("Finding opponent...")).toBeInTheDocument();
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

    expect(screen.getByText("Match found")).toBeInTheDocument();
    expect(screen.getByText("Loading arena")).toBeInTheDocument();
    expect(screen.getByText("Redirecting to the match page. Countdown begins there only.")).toBeInTheDocument();
    expect(screen.queryByText("Match starts in")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/pvp/match/match-1");
  });
});