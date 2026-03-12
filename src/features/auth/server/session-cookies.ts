import type { NextResponse } from "next/server";

const AUTH_SESSION_COOKIE_NAMES = [
  "jwt",

  // Auth.js v5
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",

  // NextAuth legacy names
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
] as const;

export function clearAuthSessionCookies(response: NextResponse) {
  for (const name of AUTH_SESSION_COOKIE_NAMES) {
    response.cookies.set({
      name,
      value: "",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }

  return response;
}