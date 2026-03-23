/** @jest-environment node */

import { createMessageBatcher } from "../message-batcher";

describe("message batcher", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("coalesces repeated progress updates for the same player within a tick", () => {
    const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const socket = {
      send(data: string) {
        sent.push(JSON.parse(data));
      },
    };

    const batcher = createMessageBatcher({
      tickMs: 60,
      isOpen: () => true,
    });

    batcher.enqueue(socket, {
      type: "PROGRESS",
      payload: { matchId: "m1", revision: 1, status: "RUNNING", userId: "u1", caretIndex: 3, wpm: 80, accuracy: 99, errors: 1 },
    });
    batcher.enqueue(socket, {
      type: "PROGRESS",
      payload: { matchId: "m1", revision: 2, status: "RUNNING", userId: "u1", caretIndex: 5, wpm: 88, accuracy: 99, errors: 1 },
    });

    jest.advanceTimersByTime(60);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "PROGRESS",
      payload: { revision: 2, caretIndex: 5, wpm: 88 },
    });

    batcher.stop();
  });

  it("drops queued messages for sockets that are no longer open", () => {
    const sent: string[] = [];
    const open = false;
    const socket = {
      send(data: string) {
        sent.push(data);
      },
    };

    const batcher = createMessageBatcher({
      tickMs: 60,
      isOpen: () => open,
    });

    batcher.enqueue(socket, {
      type: "ROOM_STATE",
      payload: { room: { code: "ABCD", status: "OPEN", maxPlayers: 2, members: [] } },
    });

    jest.advanceTimersByTime(60);

    expect(sent).toHaveLength(0);

    batcher.stop();
  });
});
