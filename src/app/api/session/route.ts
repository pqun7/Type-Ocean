import { auth } from "@/features/auth/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { logging } from '@/log/ServerLogger';

export async function POST(req: NextRequest) {
  const requestId = `session-${Date.now()}`;
  
  try {
    const session = await auth();
    
    // Safe debug logging for development
    logging.debugSensitive("Session validation attempt", {
      requestId,
      context: "auth",
      hasSession: !!session,
      hasUser: !!session?.user,
      hasUserId: !!session?.user?.id,
      userAgent: req.headers.get('user-agent') ? "present" : "missing",
      ip: "redacted"
    });
    
    if (!session?.user?.id) {
      logging.debug("Unauthenticated session check", {
        requestId,
        context: "auth",
        severity: "low",
        reason: !session ? "no_session" : !session.user ? "no_user" : "no_user_id"
      });
      return NextResponse.json({ 
        valid: false,
        reason: "not_authenticated" 
      }, { status: 401 });
    }

    // Safe logging with user details only in development
    logging.debugSensitive("Session validation successful", {
      requestId,
      userId: session.user.id,
      username: session.user.username,
      email: session.user.email,
      context: "auth"
    });

    // Production-safe logging
    logging.info("Session validation successful", {
      requestId,
      userId: session.user.id,
      context: "auth"
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
      requestId,
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