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
});