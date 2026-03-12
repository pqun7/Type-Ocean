/** @jest-environment node */

import {
  buildRoomReconnectKey,
  getPublicRoomStartCondition,
  isRoomReadyToStart,
  selectNextRoomHost,
} from "../../services/pvp-gateway/src/rooms/lifecycle";

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

  it("builds a reconnect lease key per room and user", () => {
    expect(buildRoomReconnectKey("room-1", "user-1")).toBe("pvp:room:reconnect:room-1:user-1");
  });

  it("derives the correct public room auto-start condition", () => {
    expect(
      getPublicRoomStartCondition({
        members: [
          { readyAt: new Date(), leftAt: null },
          { readyAt: new Date(), leftAt: null },
        ],
        minimumPlayers: 2,
        maxPlayers: 6,
        autoStartAt: new Date(Date.now() + 5_000),
      })
    ).toBe("all_ready");

    expect(
      getPublicRoomStartCondition({
        members: new Array(6).fill(null).map(() => ({ readyAt: null, leftAt: null })),
        minimumPlayers: 2,
        maxPlayers: 6,
        autoStartAt: new Date(Date.now() + 5_000),
      })
    ).toBe("room_full");

    expect(
      getPublicRoomStartCondition({
        members: [
          { readyAt: null, leftAt: null },
          { readyAt: null, leftAt: null },
          { readyAt: new Date(), leftAt: null },
        ],
        minimumPlayers: 2,
        maxPlayers: 6,
        autoStartAt: new Date(Date.now() - 1_000),
      })
    ).toBe("timeout");
  });
});