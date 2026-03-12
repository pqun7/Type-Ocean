import { PvpClientMessageSchema } from "@/lib/validation/ws-schemas";

describe("PvpClientMessageSchema", () => {
  it("accepts a valid HELLO message", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "HELLO",
      requestId: "request_12345",
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
      requestId: "request_67890",
      payload: {
        token: "x".repeat(64),
        clientSecret: "b".repeat(64),
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts top-level requestId on gameplay messages", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "MATCH_JOIN",
      requestId: "match_join_123",
      payload: {
        matchId: "550e8400-e29b-41d4-a716-446655440000",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts MATCH_LEAVE for explicit voluntary exits", () => {
    const result = PvpClientMessageSchema.safeParse({
      type: "MATCH_LEAVE",
      requestId: "match_leave_123",
      payload: {
        matchId: "550e8400-e29b-41d4-a716-446655440000",
      },
    });

    expect(result.success).toBe(true);
  });
});
