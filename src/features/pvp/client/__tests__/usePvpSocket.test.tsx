import React, { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";

import { PvpSocketProvider, usePvpSocket } from "../usePvpSocket";

type HarnessApi = ReturnType<typeof usePvpSocket>;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  static reset() {
    FakeWebSocket.instances = [];
  }

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function SocketHarness({ onApi }: { onApi: (api: HarnessApi) => void }) {
  const api = usePvpSocket();

  useEffect(() => {
    onApi(api);
  }, [api, onApi]);

  return <div data-testid="socket-status">{api.status}</div>;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("usePvpSocket", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    FakeWebSocket.reset();
    jest.clearAllMocks();
    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "token-1",
          expiresAt: Date.now() + 60_000,
          refreshAfter: Date.now() + 30_000,
          wsUrl: "ws://example.test/pvp",
        }),
      }),
    });
    Object.defineProperty(global, "WebSocket", {
      writable: true,
      value: FakeWebSocket,
    });
    Object.defineProperty(window, "sessionStorage", {
      writable: true,
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
      },
    });
  });

  it("refreshes the latest match snapshot after a reconnect cycle", async () => {
    let api: HarnessApi | null = null;

    render(
      <PvpSocketProvider>
        <SocketHarness onApi={(nextApi) => {
          api = nextApi;
        }} />
      </PvpSocketProvider>,
    );

    await flushAsync();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const firstSocket = FakeWebSocket.instances[0]!;
    act(() => {
      firstSocket.open();
      firstSocket.receive({
        type: "HELLO_OK",
        payload: { user: { userId: "u1", username: "me", avatar: null } },
      });
      firstSocket.receive({
        type: "MATCH_FOUND",
        payload: {
          matchId: "match-1",
          textSnapshot: "sample text",
          textId: "text-1",
          inputNonce: "nonce-1",
          serverStartAt: new Date("2026-03-24T12:00:03.000Z").toISOString(),
          players: [
            { userId: "u1", username: "me", avatar: null, slot: 0 },
            { userId: "u2", username: "them", avatar: null, slot: 1 },
          ],
        },
      });
    });

    expect(api?.getLatestMatchSnapshot("match-1")?.status).toBe("COUNTDOWN");
    expect(screen.getByTestId("socket-status")).toHaveTextContent("ready");

    act(() => {
      firstSocket.close(1001, "server restart");
    });

    expect(api?.connectionPhase.kind).toBe("reconnecting");

    let sendResult = true;
    act(() => {
      sendResult = api?.send({ type: "QUEUE_JOIN", payload: {} }) ?? true;
    });
    expect(sendResult).toBe(false);

    await flushAsync();
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    const latestSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    act(() => {
      latestSocket.open();
      latestSocket.receive({
        type: "HELLO_OK",
        payload: { user: { userId: "u1", username: "me", avatar: null } },
      });
      latestSocket.receive({
        type: "MATCH_STATE",
        payload: {
          matchId: "match-1",
          revision: 2,
          roomCode: null,
          status: "RUNNING",
          textSnapshot: "sample text",
          textId: "text-1",
          inputNonce: "nonce-1",
          serverStartAt: new Date("2026-03-24T12:00:03.000Z").toISOString(),
          snapshotAt: new Date("2026-03-24T12:00:04.000Z").toISOString(),
          players: [
            {
              userId: "u1",
              username: "me",
              avatar: null,
              slot: 0,
              caretIndex: 0,
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
      });
    });

    expect(api?.getLatestMatchSnapshot("match-1")?.status).toBe("RUNNING");
    expect(api?.getLatestMatchSnapshot("match-1")?.revision).toBe(2);
    expect(screen.getByTestId("socket-status")).toHaveTextContent("ready");
  });
});