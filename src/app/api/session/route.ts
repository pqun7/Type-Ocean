// app/api/session/route.ts
// export const runtime = 'edge';

import { auth } from "@/features/auth/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { logging } from '@/log/ServerLogger';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    
    // Enhanced logging for debugging
    logging.debug("Session validation attempt", {
      context: "auth",
      hasSession: !!session,
      hasUser: !!session?.user,
      hasUserId: !!session?.user?.id,
      userAgent: req.headers.get('user-agent'),
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    });
    
    if (!session?.user?.id) {
      logging.debug("Unauthenticated session check", {
        context: "auth",
        severity: "low",
        reason: !session ? "no_session" : !session.user ? "no_user" : "no_user_id"
      });
      return NextResponse.json({ 
        valid: false,
        reason: "not_authenticated" 
      }, { status: 401 });
    }

    logging.info("Session validation successful", {
      userId: session.user.id,
      context: "auth",
      sessionData: {
        expires: session.expires,
        username: session.user.username,
        emailVerified: session.user.emailVerified
      }
    });

    const cacheHeader = {
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=60'
    };

    return NextResponse.json({ 
      valid: true,
      userId: session.user.id,
      username: session.user.username,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      expires: session.expires 
    }, { headers: cacheHeader });

  } catch (error) {
    logging.error("Session validation failure", error, {
      context: "auth",
      severity: "critical",
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json(
      { 
        valid: false,
        reason: "server_error" 
      },
      { status: 500 }
    );
  }
}