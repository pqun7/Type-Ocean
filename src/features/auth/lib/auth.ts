import "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";   
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { Prisma, PrismaClient } from "@prisma/client";
import { loginSchema } from "@/schemas/authSchema";
import { getUserFromDb } from "@/features/auth/utils/db";
import {
  normalizeUsernameForDisplay,
  sanitizeUsernameFromProvider,
} from "@/features/auth/utils/username";
import { ZodError } from "zod";

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

const prisma = new PrismaClient();
const prismaAdapter = PrismaAdapter(prisma);

async function usernameExists(username: string): Promise<boolean> {
  const [existingUser, existingPending] = await Promise.all([
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.pendingSignup.findUnique({ where: { username }, select: { id: true } }),
  ]);

  return !!existingUser || !!existingPending;
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
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = (error.meta as unknown as { target?: string[] | string } | undefined)?.target;
  if (Array.isArray(target)) return target.includes("username");
  if (typeof target === "string") return target.includes("username");
  return false;
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
    ...prismaAdapter,
    async createUser(data) {
      const createUserFn = prismaAdapter.createUser?.bind(prismaAdapter);
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
        username: await findAvailableUsername("user"),
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
      if (user) {
        token.id = user.id;
        token.username = normalizeUsernameForDisplay(user.username as string | null | undefined);
        token.email = user.email;
        token.emailVerified = user.emailVerified;
        // propagate avatar/image for session usage
        token.image = (user as unknown as { image?: string | null }).image;
        (token as unknown as { profileRefreshedAt?: number }).profileRefreshedAt = Date.now();
        return token;
      }

      // Keep token/session in sync with DB for email verification and profile updates.
      // Throttle refresh to avoid a DB query on every request.
      const tokenUserId = token.id as string | undefined;
      if (!tokenUserId) return token;

      const now = Date.now();
      const last = (token as unknown as { profileRefreshedAt?: number }).profileRefreshedAt ?? 0;
      const REFRESH_EVERY_MS = 5 * 60 * 1000;
      if (now - last < REFRESH_EVERY_MS) return token;

      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: tokenUserId },
          select: {
            username: true,
            email: true,
            emailVerified: true,
            image: true,
          },
        });

        if (dbUser) {
          token.username = normalizeUsernameForDisplay(dbUser.username);
          token.email = dbUser.email;
          token.emailVerified = dbUser.emailVerified;
          token.image = dbUser.image;
        }
      } catch {
        // Ignore refresh failures; keep existing token values.
      }

      (token as unknown as { profileRefreshedAt?: number }).profileRefreshedAt = now;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = normalizeUsernameForDisplay(token.username as string | null | undefined);
        session.user.email = token.email as string;
        session.user.emailVerified = token.emailVerified as Date;
        session.user.image = (token as unknown as { image?: string | null }).image ?? null;
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
        await prisma.playerProfile.create({
          data: {
            user: { connect: { id: user.id } },
            username: username ?? "user",
            level: 1,
            xp: 0,
            achievements: [],
            avatar: null,
          },
        });
      } catch {
        // Ignore duplicates / race conditions
      }
    },
    async linkAccount({ user }) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.AUTH_SECRET,
  // Auth.js warns loudly when debug is enabled because it can log secrets.
  // Make it opt-in via AUTHJS_DEBUG=true.
  debug: process.env.AUTHJS_DEBUG === "true",
});
