// types/next-auth.d.ts
import "next-auth";

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
