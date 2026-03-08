// middleware.ts
import { auth } from "@/features/auth/lib/auth"
import { NextResponse, type NextRequest } from "next/server"
import { rateLimiter } from "@/lib/rate-limiter"
import { securityHeaders } from "@/lib/security-headers"
import { logger } from "@/log/ServerLogger"

// 1. Rate limited endpoints (NON-API only since APIs are skipped)
const RATE_LIMITED_ENDPOINTS = [
  '/auth', // Only non-API auth pages
]

// 2. Protected routes (page routes only)
const PROTECTED_ROUTES = [
  "/dashboard",
  "/profile",
  "/settings"
]

// 3. Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/",
  "/auth",
  "/verify",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/about",
  "/contact"
]

export default auth(async (req) => {
  const { pathname } = req.nextUrl
  const ip = getClientIP(req)
  const userAgent = req.headers.get('user-agent') || 'unknown'

  // session is available as req.auth
  const session = req.auth

  // CRITICAL FIX: Skip middleware for ALL API routes entirely
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (process.env.NODE_ENV === 'production' && !isSecureRequest(req)) {
    const secureUrl = req.nextUrl.clone()
    secureUrl.protocol = 'https:'
    return redirectWithSecurity(secureUrl)
  }

  // Convert auth-related query params to short-lived flash cookies, then redirect to a clean URL.
  // This avoids exposing internal codes in the address bar and in shared links.
  {
    const url = req.nextUrl.clone();
    const error = url.searchParams.get("error");
    const verified = url.searchParams.get("verified");
    const authStatus = url.searchParams.get("auth");
    const provider = url.searchParams.get("provider");

    const shouldClean = Boolean(error || verified || authStatus);
    if (shouldClean) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete("error");
      cleanUrl.searchParams.delete("verified");
      cleanUrl.searchParams.delete("auth");
      cleanUrl.searchParams.delete("provider");

      const response = NextResponse.redirect(cleanUrl);

      if (error) {
        response.cookies.set("__flash_error", error, {
          path: "/",
          sameSite: "lax",
          maxAge: 60,
          secure: process.env.NODE_ENV === "production",
        });
      }

      if (verified) {
        response.cookies.set("__flash_verified", verified, {
          path: "/",
          sameSite: "lax",
          maxAge: 60,
          secure: process.env.NODE_ENV === "production",
        });
      }

      if (authStatus) {
        response.cookies.set("__flash_auth", `${authStatus}:${provider ?? ""}`, {
          path: "/",
          sameSite: "lax",
          maxAge: 60,
          secure: process.env.NODE_ENV === "production",
        });
      }

      Object.entries(securityHeaders).forEach(([key, value]) => {
        response.headers.set(key, value)
      })

      return response;
    }
  }

  try {
    // 3. Apply Rate Limiting to specific non-API endpoints only
    if (RATE_LIMITED_ENDPOINTS.some(endpoint => pathname.startsWith(endpoint))) {
      const endpointConfig = RATE_LIMITED_ENDPOINTS.find(e => pathname.startsWith(e))!
      
      const { allowed, headers: rateLimitHeaders } = await rateLimiter.applyRateLimit(
        `${ip}-${userAgent}`, // Use combination of IP and User Agent as identifier
        endpointConfig
      )

      if (!allowed) {
        logger.warn('Rate limit exceeded', { 
          ip,
          endpoint: endpointConfig,
          userAgent
        })
        
        return new NextResponse('Too Many Requests', {
          status: 429,
          headers: new Headers({
            ...rateLimitHeaders,
            ...securityHeaders
          })
        })
      }
    }

    // 4. Check protected pages (non-API routes only)
    const isProtected = PROTECTED_ROUTES.some(route => pathname.startsWith(route))
    
    // 5. Handle unauthenticated users for protected pages
    if (isProtected && !session?.user) {
      logger.warn('Unauthorized access attempt to protected route', {
        ip,
        pathname,
        userAgent
      })
      
      const loginUrl = new URL("/auth", req.url)
      loginUrl.searchParams.set("callbackUrl", req.url)
      return redirectWithSecurity(loginUrl)
    }

    // 6. Email verification check ONLY for non-API routes
    // Allow access to public routes even if email is not verified
    const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route))
    const isEmailVerificationRoute = pathname.startsWith('/verify') || pathname.startsWith('/verify-email') || pathname.startsWith('/auth/verify-email')
    
    if (session?.user && 
        !session.user.emailVerified && 
        !isPublicRoute && 
        !isEmailVerificationRoute &&
        !pathname.startsWith('/auth/logout')) {
      
      logger.info('Redirecting unverified user to verification page', {
        userId: session.user.id,
        pathname
      })
      
      return redirectWithSecurity(new URL("/verify", req.url));
    }

    // 7. Add security headers and performance optimizations
    const response = NextResponse.next()
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    // 8. Cache optimizations for static requests
    if (pathname.startsWith('/_next/static')) {
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    }

    // Add cache headers for public assets
    if (pathname.match(/\.(jpg|jpeg|png|gif|ico|css|js)$/)) {
      response.headers.set('Cache-Control', 'public, max-age=86400') // 1 day
    }

    return response

  } catch (error) {
    logger.error('Middleware Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      pathname,
      ip,
      userAgent
    })

    // 9. General error page in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.redirect(new URL('/500', req.url))
    }

    return NextResponse.next()
  }
})

// 10. Helper function to get client IP
function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anonymous'
  )
}

// 11. Helper function for redirect with security headers
function redirectWithSecurity(url: URL): NextResponse {
  const response = NextResponse.redirect(url)
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

function isSecureRequest(req: NextRequest): boolean {
  const forwardedProto = req.headers.get('x-forwarded-proto')
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https'
  }

  return req.nextUrl.protocol === 'https:'
}



// 12. Middleware configuration - UPDATED to exclude ALL API routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/ (all API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, sitemap.xml
     * - public images and assets
     * - prisma studio
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|@prisma).*)"
  ]
}