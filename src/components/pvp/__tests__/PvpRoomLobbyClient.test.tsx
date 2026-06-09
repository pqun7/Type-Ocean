import React from "react";
import { act, render } from "@testing-library/react";

import PvpRoomLobbyClient from "../PvpRoomLobbyClient";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import type { ClientMessage, ServerMessage } from "@/features/pvp/client/types";

jest.mock("framer-motion", () => {
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target: Record<string, unknown>, tag: string) => {
          const MockMotion = React.forwardRef(
            ({ children, ...props }: React.HTMLProps<HTMLElement>, ref: React.Ref<HTMLElement>) =>
              React.createElement(tag, { ...props, ref }, children),
          );
          MockMotion.displayName = `MockMotion(${tag})`;
          return MockMotion;
        },
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

jest.mock("@/features/pvp/client/pvp-error-utils", () => ({
  usePvpErrorAlert: jest.fn(),
}));

jest.mock("@/features/pvp/client/usePvpSocket", () => ({
  usePvpSocket: jest.fn(),
}));

type Listener = (message: ServerMessage) => void;

const sendMock = jest.fn<boolean, [ClientMessage]>(() => true);
const usePvpSocketMock = usePvpSocket as jest.Mock;

let listener: Listener | null = null;

describe("PvpRoomLobbyClient", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    listener = null;
    sendMock.mockClear();
    pushMock.mockClear();
    usePvpSocketMock.mockReturnValue({
      status: "ready",
      error: null,
      user: { userId: "user-1", username: "me", avatar: null },
      send: sendMock,
      addListener: (nextListener: Listener) => {
        listener = nextListener;
        return () => {
          if (listener === nextListener) {
            listener = null;
          }
        };
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("leaves the room automatically when the lobby unmounts", () => {
    const { unmount } = render(<PvpRoomLobbyClient code="ROOM42" />);

    sendMock.mockClear();

    unmount();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      type: "ROOM_LEAVE",
      payload: { roomCode: "ROOM42" },
    });
  });

  it("does not leave the room when navigating into the match page", () => {
    jest.useFakeTimers();
    const { unmount } = render(<PvpRoomLobbyClient code="ROOM42" />);

    sendMock.mockClear();

    act(() => {
      listener?.({
        type: "MATCH_FOUND",
        payload: {
          matchId: "match-1",
          textSnapshot: "sample text",
          serverStartAt: new Date(Date.now() + 50).toISOString(),
          players: [],
        },
      });
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(pushMock).toHaveBeenCalledWith("/pvp/match/match-1");

    unmount();

    expect(sendMock).not.toHaveBeenCalled();
  });
});