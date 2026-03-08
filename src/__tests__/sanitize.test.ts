import {
  sanitizeAvatarUrl,
  sanitizeDisplayName,
  sanitizeRoomCode,
  sanitizeTextField,
} from "@/lib/sanitize";

describe("sanitize helpers", () => {
  it("normalizes and uppercases room codes", () => {
    expect(sanitizeRoomCode("  ab-12\u0000 ")).toBe("AB12");
  });

  it("strips control characters from text fields", () => {
    expect(sanitizeTextField("Hello\u0007   world", 20)).toBe("Hello world");
  });

  it("normalizes display names without allowing control characters", () => {
    expect(sanitizeDisplayName("\u212Blice\n", 20)).toBe("Ålice");
  });

  it("allows only http and https avatar URLs", () => {
    expect(sanitizeAvatarUrl("https://example.com/avatar.png")).toBe("https://example.com/avatar.png");
    expect(sanitizeAvatarUrl("javascript:alert(1)")).toBeNull();
  });
});
