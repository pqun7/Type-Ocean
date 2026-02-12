import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export const runtime = "nodejs";

async function handleSession(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });

  const userId = (token?.id as string | undefined) ?? token?.sub;
  if (!userId) {
    return NextResponse.json(
      {
        valid: false,
        reason: "not_authenticated",
      },
      { status: 200 }
    );
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
      expires: token?.exp ? new Date(token.exp * 1000).toISOString() : undefined,
    },
    { headers: cacheHeader }
  );
}

export async function GET(req: NextRequest) {
  try {
    return await handleSession(req);
  } catch {
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
    return NextResponse.json(
      { 
        valid: false,
        reason: "server_error" 
      },
      { status: 500 }
    );
  }
}