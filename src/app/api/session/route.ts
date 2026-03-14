import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { resolveExistingUserId, UserResolutionUnavailableError } from "@/app/api/shared.server";
import { clearAuthSessionCookies } from "@/features/auth/server/session-cookies";
import { isPrismaTemporarilyUnavailableError } from "@/lib/prisma-error-utils";

export const runtime = "nodejs";

async function handleSession(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });

  if (token?.invalidUser) {
    return clearAuthSessionCookies(NextResponse.json(
      {
        valid: false,
        reason: token.invalidUserReason === "banned" ? "banned" : "not_authenticated",
      },
      { status: 200 }
    ));
  }

  const tokenUserId = (token?.id as string | undefined) ?? token?.sub;
  const userId = await resolveExistingUserId(tokenUserId, { throwOnUnavailable: true });
  if (!userId) {
    return clearAuthSessionCookies(NextResponse.json(
      {
        valid: false,
        reason: "not_authenticated",
      },
      { status: 200 }
    ));
  }

  // Note: cache headers are most effective on GET.
  const cacheHeader = {
    "Cache-Control": "private, max-age=300, stale-while-revalidate=60",
  };

  return NextResponse.json(
    {
      valid: true,
      userId,
      username: (token?.username as string | undefined) ?? undefined,
      email: (token?.email as string | undefined) ?? undefined,
      emailVerified: (token?.emailVerified as unknown) ?? undefined,
      role: (token?.role as string | undefined) ?? undefined,
      isPrimaryAdmin: (token?.isPrimaryAdmin as boolean | undefined) ?? false,
      expires: token?.exp ? new Date(token.exp * 1000).toISOString() : undefined,
    },
    { headers: cacheHeader }
  );
}

export async function GET(req: NextRequest) {
  try {
    return await handleSession(req);
  } catch (error) {
    if (error instanceof UserResolutionUnavailableError) {
      return NextResponse.json(
        {
          valid: false,
          reason: "service_unavailable",
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    if (isPrismaTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          valid: false,
          reason: "service_unavailable",
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    return NextResponse.json(
      {
        valid: false,
        reason: "server_error",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handleSession(req);
  } catch (error) {
    if (error instanceof UserResolutionUnavailableError) {
      return NextResponse.json(
        {
          valid: false,
          reason: "service_unavailable",
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    if (isPrismaTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          valid: false,
          reason: "service_unavailable",
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    return NextResponse.json(
      { 
        valid: false,
        reason: "server_error" 
      },
      { status: 500 }
    );
  }
}