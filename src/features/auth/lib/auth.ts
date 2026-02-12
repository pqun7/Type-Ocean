import "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";   
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { loginSchema } from "@/schemas/authSchema";
import { getUserFromDb } from "@/features/auth/utils/db";
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

const allowDangerousEmailAccountLinking =
  process.env.NODE_ENV === "development" ||
  process.env.AUTH_ALLOW_DANGEROUS_EMAIL_ACCOUNT_LINKING === "true";

const githubClientId = process.env.AUTH_GITHUB_ID;
const githubClientSecret = process.env.AUTH_GITHUB_SECRET;
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(githubClientId && githubClientSecret
      ? [
          GitHub({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            authorization: { params: { scope: "user:email" } },
            profile(profile) {
              return {
                id: profile.id.toString(),
                username: profile.login,
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
              return {
                id: profile.sub,
                username: profile.name, // or use profile.email if preferred
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
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.email = user.email;
        token.emailVerified = user.emailVerified;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.email = token.email as string;
        session.user.emailVerified = token.emailVerified as Date;
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
        const username = (user as unknown as { username?: string | null }).username;
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
