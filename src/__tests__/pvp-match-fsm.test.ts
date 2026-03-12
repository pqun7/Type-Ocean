/** @jest-environment node */

import {
  canTransition,
  matchStateFromDbStatus,
  matchStateToDbStatus,
  matchStateToLegacyStatus,
  transitionMatchState,
} from "../../services/pvp-gateway/src/match-fsm";

describe("match-fsm", () => {
  it("allows valid transitions and updates the timestamp", () => {
    const next = transitionMatchState(
      {
        state: "countdown" as const,
        stateChangedAt: 100,
      },
      "live",
      250
    );

    expect(next.state).toBe("live");
    expect(next.stateChangedAt).toBe(250);
  });

  it("rejects invalid transitions", () => {
    expect(() =>
      transitionMatchState(
        {
          state: "finished" as const,
          stateChangedAt: 100,
        },
        "live",
        200
      )
    ).toThrow("Invalid match transition");
  });

  it("maps database and legacy states consistently", () => {
    expect(canTransition("lobby", "countdown")).toBe(true);
    expect(canTransition("aborted", "live")).toBe(false);
    expect(matchStateFromDbStatus("RUNNING")).toBe("live");
    expect(matchStateToDbStatus("aborted")).toBe("ABORTED");
    expect(matchStateToLegacyStatus("countdown")).toBe("COUNTDOWN");
  });
});