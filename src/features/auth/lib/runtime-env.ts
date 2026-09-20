const LOCAL_AUTH_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalAuthUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    return LOCAL_AUTH_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function vercelAuthOrigin(env: NodeJS.ProcessEnv): string | null {
  const hostname =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL
      : env.VERCEL_URL ?? env.VERCEL_PROJECT_PRODUCTION_URL;

  if (!hostname) return null;

  try {
    const url = new URL(
      hostname.startsWith("http://") || hostname.startsWith("https://")
        ? hostname
        : `https://${hostname}`,
    );
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Auth.js gives AUTH_URL/NEXTAUTH_URL precedence over the incoming request.
 * A stale localhost value in Vercel therefore sends every OAuth callback to a
 * developer machine. Replace only local overrides with Vercel's canonical
 * deployment origin (or fall back to the incoming request origin).
 */
export function sanitizeAuthUrlEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const isVercelRuntime =
    env.VERCEL === "1" ||
    Boolean(env.VERCEL_URL) ||
    Boolean(env.VERCEL_PROJECT_PRODUCTION_URL);

  if (!isVercelRuntime) return;

  const hasLocalOverride =
    isLocalAuthUrl(env.AUTH_URL) || isLocalAuthUrl(env.NEXTAUTH_URL);
  if (!hasLocalOverride) return;

  const deployedOrigin = vercelAuthOrigin(env);
  if (deployedOrigin) {
    env.AUTH_URL = deployedOrigin;
    env.NEXTAUTH_URL = deployedOrigin;
    return;
  }

  if (isLocalAuthUrl(env.AUTH_URL)) delete env.AUTH_URL;
  if (isLocalAuthUrl(env.NEXTAUTH_URL)) delete env.NEXTAUTH_URL;
}
