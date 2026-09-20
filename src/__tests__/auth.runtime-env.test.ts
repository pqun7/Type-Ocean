/** @jest-environment node */

import { sanitizeAuthUrlEnvironment } from "@/features/auth/lib/runtime-env";

describe("sanitizeAuthUrlEnvironment", () => {
  it("removes localhost Auth.js URL overrides on Vercel", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VERCEL: "1",
      AUTH_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://127.0.0.1:3000",
    };

    sanitizeAuthUrlEnvironment(env);

    expect(env.AUTH_URL).toBeUndefined();
    expect(env.NEXTAUTH_URL).toBeUndefined();
  });

  it("preserves a deployed HTTPS origin", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VERCEL: "1",
      AUTH_URL: "https://type-ocean-theta.vercel.app",
      NEXTAUTH_URL: "https://type-ocean-theta.vercel.app",
    };

    sanitizeAuthUrlEnvironment(env);

    expect(env.AUTH_URL).toBe("https://type-ocean-theta.vercel.app");
    expect(env.NEXTAUTH_URL).toBe("https://type-ocean-theta.vercel.app");
  });

  it("replaces localhost with Vercel's production origin when available", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "type-ocean-theta.vercel.app",
      AUTH_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
    };

    sanitizeAuthUrlEnvironment(env);

    expect(env.AUTH_URL).toBe("https://type-ocean-theta.vercel.app");
    expect(env.NEXTAUTH_URL).toBe("https://type-ocean-theta.vercel.app");
  });

  it("preserves localhost for local development", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "development",
      NEXTAUTH_URL: "http://localhost:3000",
    };

    sanitizeAuthUrlEnvironment(env);

    expect(env.NEXTAUTH_URL).toBe("http://localhost:3000");
  });
});
