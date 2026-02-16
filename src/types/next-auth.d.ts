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
    };
  }
  interface User {
    username?: string | null;
    emailVerified?: Date | null;
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    username?: string | null;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    username?: string | null;
  }
}
