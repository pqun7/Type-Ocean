// types/next-auth.d.ts
import "next-auth";
import "next-auth/adapters";
import "@auth/core/adapters";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username?: string | null;
      email?: string | null;
      image?: string | null;
      emailVerified?: Date | null;
      role?: string | null;
      banned?: boolean | null;
      isPrimaryAdmin?: boolean | null;
    };
  }
  interface User {
    username?: string | null;
    emailVerified?: Date | null;
    role?: string | null;
    banned?: boolean | null;
    isPrimaryAdmin?: boolean | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string | null;
    email?: string | null;
    image?: string | null;
    emailVerified?: Date | null;
    role?: string | null;
    banned?: boolean | null;
    isPrimaryAdmin?: boolean | null;
    profileRefreshedAt?: number;
    invalidUser?: boolean;
    invalidUserReason?: "missing" | "banned";
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    username?: string | null;
    role?: string | null;
    banned?: boolean | null;
    isPrimaryAdmin?: boolean | null;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    username?: string | null;
    role?: string | null;
    banned?: boolean | null;
    isPrimaryAdmin?: boolean | null;
  }
}
