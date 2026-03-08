import { PvpClientMessageSchema } from "@/lib/validation/ws-schemas";

describe("PvpClientMessageSchema", () => {
  it("accepts a valid HELLO message", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "HELLO",
      payload: {
        token: "x".repeat(64),
        clientSecret: "a".repeat(64),
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects HELLO when the client secret is malformed", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "HELLO",
      payload: {
        token: "x".repeat(64),
        clientSecret: "short",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized ROOM_JOIN messages", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "ROOM_JOIN",
      payload: {
        code: "ROOM1",
        language: "en",
        padding: "x".repeat(2_000),
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts AUTH_REFRESH with the same strict payload shape", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "AUTH_REFRESH",
      payload: {
        token: "x".repeat(64),
        clientSecret: "b".repeat(64),
      },
    });

    expect(result.success).toBe(true);
  });
});
