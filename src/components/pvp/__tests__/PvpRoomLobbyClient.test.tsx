import React from "react";
import { act, render } from "@testing-library/react";

import PvpRoomLobbyClient from "../PvpRoomLobbyClient";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import type { ServerMessage, ClientMessage } from "@/features/pvp/client/types";

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

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

jest.mock("@/features/pvp/client/usePvpSocket", () => ({
  usePvpSocket: jest.fn(),
}));

jest.mock("@/features/pvp/client/pvp-error-utils", () => ({
  usePvpErrorAlert: jest.fn(),
}));

type Listener = (message: ServerMessage) => void;

const usePvpSocketMock = usePvpSocket as jest.Mock;
const sendMock = jest.fn<boolean, [ClientMessage]>(() => true);

let listeners: Listener[] = [];

describe("PvpRoomLobbyClient", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    listeners = [];
    pushMock.mockClear();
    sendMock.mockClear();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
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
    }));
  });

  it("sends ROOM_LEAVE when the room page unmounts to a non-match page", () => {
    const view = render(<PvpRoomLobbyClient code="ROOM1" />);

    sendMock.mockClear();
    view.unmount();

    expect(sendMock).toHaveBeenCalledWith({ type: "ROOM_LEAVE", payload: { roomCode: "ROOM1" } });
  });

  it("does not send ROOM_LEAVE when navigation continues into the match page", async () => {
    const view = render(<PvpRoomLobbyClient code="ROOM1" />);

    sendMock.mockClear();

    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: "MATCH_FOUND",
          payload: {
            matchId: "550e8400-e29b-41d4-a716-446655440000",
            textSnapshot: "sample text",
            serverStartAt: new Date(Date.now() - 1_000).toISOString(),
            players: [],
          },
        } as ServerMessage);
      }
    });

    view.unmount();

    expect(pushMock).toHaveBeenCalledWith("/pvp/match/550e8400-e29b-41d4-a716-446655440000");
    expect(sendMock).not.toHaveBeenCalledWith({ type: "ROOM_LEAVE", payload: { roomCode: "ROOM1" } });
  });
});