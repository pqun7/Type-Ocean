import { hashPvpFingerprint, normalizePvpClientSecret } from "@/lib/pvp/fingerprint";

describe("PvP fingerprint helpers", () => {
  it("normalizes valid client secrets", () => {
    expect(normalizePvpClientSecret(` ${"a".repeat(64)} `)).toBe("a".repeat(64));
  });

  it("rejects invalid client secrets", () => {
    expect(() => normalizePvpClientSecret("bad secret")).toThrow(/invalid pvp client secret/i);
  });

  it("creates deterministic fingerprints for the same user agent and secret", () => {
    const first = hashPvpFingerprint({ userAgent: "Mozilla/5.0", clientSecret: "a".repeat(64) });
    const second = hashPvpFingerprint({ userAgent: "Mozilla/5.0", clientSecret: "a".repeat(64) });

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });
});
