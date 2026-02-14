import React from "react";
import { render, act } from "@testing-library/react";

import type { DailyChallenge, SessionData } from "../types/level";

jest.mock("../services/dailyChallengeService", () => {
  return {
    updateDailyChallenge: jest.fn(),
  };
});

import { updateDailyChallenge } from "../services/dailyChallengeService";
import { useChallengeHandler } from "./useChallengeHandler";

function renderUseChallengeHandler(props: {
  userId?: string;
  challenge?: DailyChallenge | null;
}) {
  let api: ReturnType<typeof useChallengeHandler> | null = null;

  function Harness() {
    api = useChallengeHandler(props.userId, props.challenge);
    return null;
  }

  render(<Harness />);

  return {
    getApi: () => {
      if (!api) throw new Error("Hook not initialized");
      return api;
    },
  };
}

describe("useChallengeHandler", () => {
  const baseSession: SessionData = {
    wpm: 70,
    accuracy: 97,
    textLength: 100,
    timeSpent: 60,
    errors: 0,
    dailyAvgWpm: 70,
    dailyAvgAcc: 97,
    sessionsCount: 1,
    textType: "SHORT",
  };

  it("returns no XP and does not call API when userId/challenge missing", async () => {
    const { getApi } = renderUseChallengeHandler({ userId: undefined, challenge: null });

    let response: { completed: boolean; xp: number } | undefined;
    await act(async () => {
      response = await getApi().handleDailyChallenge(baseSession);
    });

    expect(response).toEqual({ completed: false, xp: 0 });
    expect(updateDailyChallenge).not.toHaveBeenCalled();
  });

  it("awards XP only once when transitioning to completed", async () => {
    const challenge: DailyChallenge = {
      id: "speedCombo-u1-20260214-aaaaaa",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 123,
      difficulty: 1,
      status: 0,
      data: {},
    };

    (updateDailyChallenge as unknown as jest.Mock).mockResolvedValue({
      ...challenge,
      status: 1,
    });

    const { getApi } = renderUseChallengeHandler({ userId: "u1", challenge });

    let first: { completed: boolean; xp: number } | undefined;
    await act(async () => {
      first = await getApi().handleDailyChallenge(baseSession);
    });

    expect(first).toEqual({ completed: true, xp: 123 });

    let second: { completed: boolean; xp: number } | undefined;
    await act(async () => {
      second = await getApi().handleDailyChallenge(baseSession);
    });

    // Still completed, but XP should not be re-awarded.
    expect(second).toEqual({ completed: true, xp: 0 });
  });
});
