/** @jest-environment node */

import {
  buildRoomReconnectKey,
  getActiveRoomMembers,
  isRoomReadyToStart,
  selectNextRoomHost,
} from "../rooms/lifecycle";

describe("pvp room lifecycle helpers", () => {
  it("selects the next host by earliest active join time", () => {
    expect(
      selectNextRoomHost(
        [
          { userId: "u1", joinedAt: new Date("2026-03-10T10:00:00.000Z"), readyAt: null, leftAt: new Date("2026-03-10T10:10:00.000Z") },
          { userId: "u2", joinedAt: new Date("2026-03-10T10:01:00.000Z"), readyAt: null, leftAt: null },
          { userId: "u3", joinedAt: new Date("2026-03-10T10:02:00.000Z"), readyAt: null, leftAt: null },
        ],
        "u1"
      )
    ).toBe("u2");
  });

  it("keeps the current host when the host is still active", () => {
    expect(
      selectNextRoomHost(
        [
          { userId: "u1", joinedAt: new Date("2026-03-10T10:00:00.000Z"), readyAt: null, leftAt: null },
          { userId: "u2", joinedAt: new Date("2026-03-10T10:01:00.000Z"), readyAt: null, leftAt: null },
        ],
        "u2"
      )
    ).toBe("u2");
  });

  it("returns null host when all members have left", () => {
    expect(
      selectNextRoomHost(
        [
          { userId: "u1", joinedAt: new Date("2026-03-10T10:00:00.000Z"), readyAt: null, leftAt: new Date("2026-03-10T10:10:00.000Z") },
          { userId: "u2", joinedAt: new Date("2026-03-10T10:01:00.000Z"), readyAt: null, leftAt: new Date("2026-03-10T10:11:00.000Z") },
        ],
        "u1"
      )
    ).toBeNull();
  });

  it("filters only active members", () => {
    const active = getActiveRoomMembers([
      { userId: "u1", leftAt: new Date("2026-03-10T10:10:00.000Z") },
      { userId: "u2", leftAt: null },
      { userId: "u3", leftAt: null },
    ]);

    expect(active).toHaveLength(2);
    expect(active.map((m) => m.userId)).toEqual(["u2", "u3"]);
  });

  it("requires every active player to be ready before host start", () => {
    expect(
      isRoomReadyToStart({
        members: [
          { readyAt: new Date(), leftAt: null },
          { readyAt: new Date(), leftAt: null },
        ],
      })
    ).toBe(true);

    expect(
      isRoomReadyToStart({
        members: [
          { readyAt: new Date(), leftAt: null },
          { readyAt: null, leftAt: null },
        ],
      })
    ).toBe(false);
  });

  it("respects minimum players override", () => {
    expect(
      isRoomReadyToStart({
        members: [
          { readyAt: new Date(), leftAt: null },
          { readyAt: new Date(), leftAt: null },
        ],
        minimumPlayers: 3,
      })
    ).toBe(false);

    expect(
      isRoomReadyToStart({
        members: [
          { readyAt: new Date(), leftAt: null },
          { readyAt: new Date(), leftAt: null },
          { readyAt: new Date(), leftAt: null },
        ],
        minimumPlayers: 3,
      })
    ).toBe(true);
  });

  it("builds a reconnect lease key per room and user", () => {
    expect(buildRoomReconnectKey("room-1", "user-1")).toBe("pvp:room:reconnect:room-1:user-1");
  });
});