// src/auth.ts (new configuration file)
import "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { loginSchema } from "@/lib/schema";
import { getUserFromDb } from "@/utils/db";
import { ZodError } from "zod";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username?: string | null;
      // name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
  interface User {
    username?: string | null;
  }
}

const prisma = new PrismaClient();

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
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
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const { username, password } = await loginSchema.parseAsync(
            credentials
          );
          const user = await getUserFromDb(username, password);
          return {
            id: user.id,
            username: user.username,
            email: user.email,
          };
        }  catch (error) {
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
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth",
    error: "/auth",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.AUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
});
