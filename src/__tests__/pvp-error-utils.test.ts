/** @jest-environment jsdom */

import { PVP_ERROR_CODES } from "@/features/pvp/shared/error-codes";
import { toSafePvpErrorMessage } from "@/features/pvp/client/pvp-error-utils";

describe("pvp error utils", () => {
  it("maps structured queue socket errors to stable player-safe copy", () => {
    expect(
      toSafePvpErrorMessage({
        code: PVP_ERROR_CODES.QUEUE_SOCKET_NOT_READY,
        message: "Ranked queue socket is not ready",
        retryable: true,
      })
    ).toBe("The ranked queue is still connecting. Wait a moment and try again.");
  });

  it("maps structured queue user availability errors to refresh guidance", () => {
    expect(
      toSafePvpErrorMessage({
        code: PVP_ERROR_CODES.QUEUE_USER_UNAVAILABLE,
        message: "Your PvP session is no longer available. Refresh and rejoin the queue.",
        retryable: true,
      })
    ).toBe("Your PvP session is no longer available. Refresh and rejoin the queue.");
  });

  it("maps structured queue connection closed errors to reconnect guidance", () => {
    expect(
      toSafePvpErrorMessage({
        code: PVP_ERROR_CODES.QUEUE_CONNECTION_CLOSED,
        message: "The PvP connection was closed",
        retryable: true,
      })
    ).toBe("The PvP connection was interrupted. Please refresh and try again.");
  });

  it("maps structured superseded match session errors to tab guidance", () => {
    expect(
      toSafePvpErrorMessage({
        code: PVP_ERROR_CODES.MATCH_SESSION_SUPERSEDED,
        message: "This match was opened in another tab",
        retryable: false,
      })
    ).toBe("This match is active in another tab. Continue there or close the other tab first.");
  });

  it("maps ws-token fetch failures to gateway connection guidance", () => {
    expect(toSafePvpErrorMessage("Failed to get token from /api/pvp/ws-token")).toBe(
      "We couldn't connect you to the PvP server right now. Please try again in a moment."
    );
  });
});