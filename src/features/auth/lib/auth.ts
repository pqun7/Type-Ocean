import "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";   
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { loginSchema } from "@/schemas/authSchema";
import { getUserFromDb } from "@/features/auth/utils/db";
import { db } from "@/db";
import {
  accounts,
  authenticators,
  pendingSignups,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";
import {
  normalizeUsernameForDisplay,
  sanitizeUsernameFromProvider,
} from "@/features/auth/utils/username";
import { ensurePlayerProfile } from "@/features/auth/server/player-profile";
import { ZodError } from "zod";
import { sanitizeAuthUrlEnvironment } from "./runtime-env";

sanitizeAuthUrlEnvironment();

// declare module "next-auth" {
//   interface Session {
//     user: {
//       id: string;
//       username?: string | null;
//       email?: string | null;
//       image?: string | null;
//       emailVerified?: Date | null;
//     };
//   }
//   interface User {
//     username?: string | null;
//     emailVerified?: Date | null;
//   }
// }

const drizzleAdapter = (DrizzleAdapter as any)(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
  authenticatorsTable: authenticators,
} as any);

type AuthUserState = {
  username: string;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  role: string;
  banned: boolean;
  isPrimaryAdmin: boolean;
};

async function getAuthUserState(userId: string): Promise<AuthUserState | null> {
  const rows = await db
    .select({
      username: users.username,
      email: users.email,
      emailVerified: users.emailVerified,
      image: users.image,
      role: users.role,
      banned: users.banned,
      isPrimaryAdmin: users.isPrimaryAdmin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];

  if (!row) return null;

  return {
    username: row.username,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
    banned: row.banned,
    isPrimaryAdmin: row.isPrimaryAdmin,
  };
}

function invalidateToken(token: JWT, reason: "missing" | "banned") {
  delete token.id;
  delete token.username;
  delete token.email;
  delete token.emailVerified;
  delete token.image;
  delete token.role;
  delete token.banned;
  delete token.isPrimaryAdmin;
  token.invalidUser = true;
  token.invalidUserReason = reason;
  (token as unknown as { profileRefreshedAt?: number }).profileRefreshedAt = Date.now();
  return token;
}

async function usernameExists(username: string): Promise<boolean> {
  const [existingUser, existingPending] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1),
    db
      .select({ id: pendingSignups.id })
      .from(pendingSignups)
      .where(eq(pendingSignups.username, username))
      .limit(1),
  ]);

  return existingUser.length > 0 || existingPending.length > 0;
}

function withNumericSuffix(base: string, suffix: string): string {
  const maxLen = 20;
  const safeSuffix = suffix.slice(0, maxLen);
  const headLen = Math.max(0, maxLen - safeSuffix.length);
  return `${base.slice(0, headLen)}${safeSuffix}`;
}

async function findAvailableUsername(baseInput: string): Promise<string> {
  const base = sanitizeUsernameFromProvider(baseInput);

  // 1) Try the base username as-is.
  if (!(await usernameExists(base))) return base;

  // 2) Add a numeric suffix (no underscore) until we find an available username.
  // Keep attempts bounded; DB uniqueness is the final safety net.
  for (let i = 1; i <= 10_000; i++) {
    const candidate = withNumericSuffix(base, String(i));
    if (!(await usernameExists(candidate))) return candidate;
  }

  // Extremely unlikely fallback; keeps sign-in functional.
  return withNumericSuffix("user", String(Date.now()).slice(-6));
}

function isUsernameUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const code = (error as { code?: unknown }).code;
  if (code !== "23505") return false;

  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return message.includes("username");
}

const allowDangerousEmailAccountLinking =
  process.env.NODE_ENV === "development" ||
  process.env.AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING === "true";

const githubClientId = process.env.AUTH_GITHUB_ID;
const githubClientSecret = process.env.AUTH_GITHUB_SECRET;
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: {
    ...drizzleAdapter,
    async createUser(data) {
      const createUserFn = drizzleAdapter.createUser?.bind(drizzleAdapter);
      if (!createUserFn) {
        throw new Error("ADAPTER_CREATE_USER_MISSING");
      }

      const base =
        (data as unknown as { username?: string | null }).username ??
        data.email?.split("@")[0] ??
        "user";

      // Ensure a stable + acceptable username (base, or base+number).
      let username = await findAvailableUsername(base);

      for (let attempt = 0; attempt < 25; attempt++) {
        try {
          return await createUserFn({
            ...data,
            // The User table uses `username` instead of the optional Auth.js `name` column.
            name: undefined,
            username,
          });
        } catch (err) {
          if (!isUsernameUniqueViolation(err)) throw err;
          // Race condition: another signup took the username.
          username = await findAvailableUsername(base);
        }
      }

      // Give up after bounded retries.
      return await createUserFn({
        ...data,
        name: undefined,
        username: await findAvailableUsername("user"),
      });
    },
    async updateUser(data) {
      const updateUserFn = drizzleAdapter.updateUser?.bind(drizzleAdapter);
      if (!updateUserFn) {
        throw new Error("ADAPTER_UPDATE_USER_MISSING");
      }

      return await updateUserFn({
        ...data,
        // Prevent writes to non-existent `name` column in the User table.
        name: undefined,
      });
    },
  },
  providers: [
    ...(githubClientId && githubClientSecret
      ? [
          GitHub({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            authorization: { params: { scope: "user:email" } },
            profile(profile) {
              const username = sanitizeUsernameFromProvider(profile.login);
              return {
                id: profile.id.toString(),
                username,
                email: profile.email,
                image: profile.avatar_url,
              };
            },
          }),
        ]
      : []),
    ...(googleClientId && googleClientSecret
      ? [
          // ✅ Google OAuth provider
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            authorization: { params: { scope: "openid email profile" } },
            // Fixes OAuthAccountNotLinked for users who previously signed up with credentials.
            // In production, keep this opt-in via AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING.
            allowDangerousEmailAccountLinking: allowDangerousEmailAccountLinking,
            profile(profile) {
              const emailLocalPart = profile.email?.split("@")[0];
              const baseUsername = emailLocalPart ?? profile.name ?? profile.sub;
              const username = sanitizeUsernameFromProvider(baseUsername);
              return {
                id: profile.sub,
                username,
                email: profile.email,
                image: profile.picture,
              };
            },
          }),
        ]
      : []),
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const { username, password } =
            await loginSchema.parseAsync(credentials);
          const user = await getUserFromDb(username, password);
          return {
            id: user.id,
            username: user.username,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
          };
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error("Invalid credentials format");
          }

          let errorMessage = "Authentication failed";
          if (error instanceof Error) {
            errorMessage = error.message;
          }

          throw new Error(errorMessage);
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const tokenUserId = user?.id ?? (token.id as string | undefined);
      if (!tokenUserId) return token;

      if (user) {
        token.id = user.id;
      }

      try {
        // JWT presence alone is not sufficient; the backing user may have been deleted
        // or banned by server-side state changes. Validate against the DB on every auth read.
        const dbUser = await getAuthUserState(tokenUserId);

        if (!dbUser) {
          return invalidateToken(token, "missing");
        }

        if (dbUser.banned) {
          return invalidateToken(token, "banned");
        }

        token.id = tokenUserId;
        token.username = normalizeUsernameForDisplay(dbUser.username);
        token.email = dbUser.email;
        token.emailVerified = dbUser.emailVerified;
        token.image = dbUser.image;
        token.role = dbUser.role;
        token.banned = false;
        token.isPrimaryAdmin = dbUser.isPrimaryAdmin;
        token.invalidUser = false;
        delete token.invalidUserReason;
      } catch {
        // Ignore refresh failures; keep existing token values.
      }

      (token as unknown as { profileRefreshedAt?: number }).profileRefreshedAt = Date.now();
      return token;
    },
    session({ session, token }) {
      if (token.invalidUser || !token.id) {
        session.user.id = "";
        session.user.username = null;
        session.user.email = "";
        session.user.emailVerified = null;
        session.user.image = null;
        session.user.role = null;
        session.user.banned = null;
        session.user.isPrimaryAdmin = null;
        return session;
      }

      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = normalizeUsernameForDisplay(token.username as string | null | undefined);
        session.user.email = token.email as string;
        session.user.emailVerified = token.emailVerified as Date;
        session.user.image = (token as unknown as { image?: string | null }).image ?? null;
        session.user.role = (token as { role?: string | null }).role ?? "user";
        session.user.banned = (token as { banned?: boolean | null }).banned ?? false;
        session.user.isPrimaryAdmin = (token as { isPrimaryAdmin?: boolean | null }).isPrimaryAdmin ?? false;
      }
      return session;
    },
  },
  pages: {
    // Keep all auth flows on the existing /auth page.
    // Errors are surfaced via the `error` query param and handled client-side.
    signIn: "/auth",
    error: "/auth",
    signOut: "/auth",
    // If you ever add an email/magic-link provider, point this to a real page.
    verifyRequest: "/auth",
    newUser: "/auth?form=signup",
  },
  events: {
    async createUser({ user }) {
      // Ensure PlayerProfile exists for OAuth-created users
      try {
        if (!user.id) return;
        const username = normalizeUsernameForDisplay(
          (user as unknown as { username?: string | null }).username
        );
        await ensurePlayerProfile({
          userId: user.id,
          username: username ?? "user",
        });
      } catch {
        // Ignore duplicates / race conditions
      }
    },
    async linkAccount({ user }) {
      if (typeof user.id !== "string" || user.id.length === 0) return;
      const linkedUserId: string = user.id;

      await db
        .update(users)
        .set({ emailVerified: new Date(), updatedAt: new Date() })
        .where(eq(users.id, linkedUserId));
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "development",
  secret: process.env.AUTH_SECRET,
  // Auth.js warns loudly when debug is enabled because it can log secrets.
  // Make it opt-in via AUTHJS_DEBUG=true.
  debug: process.env.AUTHJS_DEBUG === "true",
});
