// app/api/session/route.ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { logging } from '@/log/ServerLogger';

export async function POST() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      logging.debug("Unauthenticated session check", {
        context: "auth",
        severity: "low"
      });
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    logging.info("Session validation successful", {
      userId: session.user.id,
      context: "auth",
      sessionData: {
        expires: session.expires,
      }
    });

    const cacheHeader = {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60'
    };

    return NextResponse.json({ 
      valid: true,
      userId: session.user.id,
      expires: session.expires 
    }, { headers: cacheHeader });

  } catch (error) {
    logging.error("Session validation failure", error, {
      context: "auth",
      severity: "critical"
    });
    
    return NextResponse.json(
      { valid: false }, // إرجاع رد عام دون تفاصيل
      { status: 500 }
    );
  }
}