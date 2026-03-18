// middleware.ts
import jwt, {
  JsonWebTokenError,
  NotBeforeError,
  TokenExpiredError,
  type JwtPayload,
} from "jsonwebtoken"
import { auth } from "@/features/auth/lib/auth"
import { db } from "@/db"
import {
  buildProtectedRequestUserHeaders,
  type ProtectedRequestUser,
} from "@/features/auth/server/protected-request-user"
import { connectIfNeeded, redis } from "@/lib/redis"
import { NextResponse, type NextRequest } from "next/server"
import { rateLimiter } from "@/lib/rate-limiter"
import { securityHeaders } from "@/lib/security-headers"
import { logger } from "@/log/ServerLogger"
import { sql } from "drizzle-orm"

export const runtime = "nodejs"

const AUTH_COOKIE_NAME = "jwt"
const PROTECTED_API_PREFIX = "/api/protected"
const MISSING_USER_CACHE_PREFIX = "auth:missing-user"
const MISSING_USER_CACHE_TTL_SECONDS = 60

const PVP_INSECURE_LOCALHOST = process.env.PVP_INSECURE_LOCALHOST === "1"

type AuthTokenPayload = JwtPayload & {
  userId: string
}

type AuthenticatedUser = ProtectedRequestUser & {
  banned: boolean
}

// 1. Rate limited endpoints (NON-API only since APIs are skipped)
const RATE_LIMITED_ENDPOINTS = [
  '/auth', // Only non-API auth pages
]

// 2. Protected routes (page routes only)
const PROTECTED_ROUTES = [
  "/dashboard",
  "/admin",
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

  if (isProtectedApiPath(pathname)) {
    return handleProtectedApiRequest(req, { pathname, ip, userAgent })
  }

  // Non-protected API routes are intentionally left alone.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  if (shouldEnforceHttps(req) && !isSecureRequest(req)) {
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
          secure: shouldUseSecureCookies(req),
        });
      }

      if (verified) {
        response.cookies.set("__flash_verified", verified, {
          path: "/",
          sameSite: "lax",
          maxAge: 60,
          secure: shouldUseSecureCookies(req),
        });
      }

      if (authStatus) {
        response.cookies.set("__flash_auth", `${authStatus}:${provider ?? ""}`, {
          path: "/",
          sameSite: "lax",
          maxAge: 60,
          secure: shouldUseSecureCookies(req),
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

async function handleProtectedApiRequest(
  req: NextRequest,
  context: { pathname: string; ip: string; userAgent: string }
): Promise<NextResponse> {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value

  if (!token) {
    logger.warn('Protected API request missing auth cookie', {
      pathname: context.pathname,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return createAuthFailureResponse(req, 401, 'UNAUTHORIZED')
  }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    logger.error('Protected API middleware is missing JWT_SECRET', new Error('JWT_SECRET is not configured'), {
      pathname: context.pathname,
    })

    return createServerErrorResponse()
  }

  let payload: AuthTokenPayload

  try {
    payload = verifyToken(token, jwtSecret)
  } catch (error) {
    if (
      error instanceof TokenExpiredError ||
      error instanceof JsonWebTokenError ||
      error instanceof NotBeforeError
    ) {
      logger.warn('Protected API request presented an invalid JWT cookie', {
        pathname: context.pathname,
        ip: context.ip,
        userAgent: context.userAgent,
        error: error.message,
      })

      return createAuthFailureResponse(req, 401, 'INVALID_TOKEN')
    }

    logger.error('Protected API JWT verification failed unexpectedly', error, {
      pathname: context.pathname,
    })

    return createServerErrorResponse()
  }

  const user = await findAuthenticatedUser(payload.userId, context)

  if (!user) {
    await writeMissingUserCache(payload.userId)

    logger.warn('Protected API request used a valid JWT for a user that no longer exists', {
      pathname: context.pathname,
      userId: payload.userId,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return createAuthFailureResponse(req, 401, 'USER_NOT_FOUND')
  }

  if (user.banned) {
    logger.warn('Protected API request blocked for banned user', {
      pathname: context.pathname,
      userId: user.id,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return createForbiddenResponse(req)
  }

  const response = NextResponse.next({
    request: {
      headers: buildProtectedRequestUserHeaders(user, req.headers),
    },
  })

  applySecurityHeaders(response)
  return response
}

function verifyToken(token: string, secret: string): AuthTokenPayload {
  const payload = jwt.verify(token, secret)

  if (!isAuthTokenPayload(payload)) {
    throw new JsonWebTokenError('JWT payload is missing a valid userId')
  }

  return payload
}

function isAuthTokenPayload(payload: string | JwtPayload): payload is AuthTokenPayload {
  return typeof payload !== 'string' && typeof payload.userId === 'string' && payload.userId.length > 0
}

async function findAuthenticatedUser(
  userId: string,
  context: { pathname: string; ip: string; userAgent: string }
): Promise<AuthenticatedUser | null> {
  const isKnownMissingUser = await readMissingUserCache(userId)
  if (isKnownMissingUser) {
    logger.warn('Protected API request hit missing-user negative cache', {
      pathname: context.pathname,
      userId,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return null
  }

  try {
    // We verify the JWT signature and still hit the database on every protected request.
    // A valid JWT only proves the token was minted by us; it does not prove the user still
    // exists or is still allowed to act. This fail-fast lookup blocks stale sessions for
    // deleted accounts, honors the banned flag, and keeps auth revocation server-controlled.
    const result = await db.execute(sql`
      SELECT "id", "email", "role", "banned"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
    `)

    const user = (result.rows[0] as AuthenticatedUser | undefined) ?? null

    if (user) {
      await deleteMissingUserCache(userId)
    }

    return user
  } catch (error) {
    logger.error('Protected API user lookup failed', error, {
      pathname: context.pathname,
      userId,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    throw error
  }
}

function createAuthFailureResponse(
  req: NextRequest,
  status: number,
  error: 'UNAUTHORIZED' | 'USER_NOT_FOUND' | 'INVALID_TOKEN'
): NextResponse {
  const response = NextResponse.json({ error }, { status })

  clearAuthCookie(response, req)
  applySecurityHeaders(response)

  return response
}

function createForbiddenResponse(req: NextRequest): NextResponse {
  const response = NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  clearAuthCookie(response, req)
  applySecurityHeaders(response)

  return response
}

function createServerErrorResponse(): NextResponse {
  const response = NextResponse.json(
    { error: 'INTERNAL_SERVER_ERROR' },
    { status: 500 }
  )

  applySecurityHeaders(response)
  return response
}

function clearAuthCookie(response: NextResponse, req: NextRequest) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: shouldUseSecureCookies(req),
    sameSite: 'strict',
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  })
}

function applySecurityHeaders(response: NextResponse) {
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
}

function shouldUseSecureCookies(req: NextRequest): boolean {
  if (shouldAllowInsecureLocalhost(req)) {
    return false
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https'
  }

  return process.env.NODE_ENV === 'production'
}

function isProtectedApiPath(pathname: string): boolean {
  return pathname === PROTECTED_API_PREFIX || pathname.startsWith(`${PROTECTED_API_PREFIX}/`)
}

function getMissingUserCacheKey(userId: string): string {
  return `${MISSING_USER_CACHE_PREFIX}:${userId}`
}

async function readMissingUserCache(userId: string): Promise<boolean> {
  try {
    await connectIfNeeded()
    const value = await redis.get(getMissingUserCacheKey(userId))
    return value === '1'
  } catch {
    return false
  }
}

async function writeMissingUserCache(userId: string): Promise<void> {
  try {
    await connectIfNeeded()
    await redis.setex(getMissingUserCacheKey(userId), MISSING_USER_CACHE_TTL_SECONDS, '1')
  } catch {
    // Ignore Redis failures and fall back to DB validation.
  }
}

async function deleteMissingUserCache(userId: string): Promise<void> {
  try {
    await connectIfNeeded()
    await redis.del(getMissingUserCacheKey(userId))
  } catch {
    // Ignore Redis failures and leave cache cleanup best-effort.
  }
}

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

function shouldEnforceHttps(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  return !shouldAllowInsecureLocalhost(req)
}

function shouldAllowInsecureLocalhost(req: NextRequest): boolean {
  if (!PVP_INSECURE_LOCALHOST) return false
  return isLocalhostHost(req.nextUrl.hostname)
}

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}



// 12. Middleware configuration - UPDATED to exclude ALL API routes
export const config = {
  matcher: [
    '/api/protected/:path*',
    /*
     * Match all request paths except for the ones starting with:
     * - api/ (all API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, sitemap.xml
     * - public images and assets
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"
  ]
}

/**
 * Example usage inside a protected route handler:
 *
 * export const runtime = "nodejs";
 *
 * import { NextRequest, NextResponse } from "next/server";
 * import { readProtectedRequestUser } from "@/features/auth/server/protected-request-user";
 *
 * export async function GET(req: NextRequest) {
 *   const user = readProtectedRequestUser(req);
 *
 *   if (!user) {
 *     return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
 *   }
 *
 *   return NextResponse.json({ user });
 * }
 *
 * Next.js middleware cannot safely attach a runtime req.user property to NextRequest.
 * Forwarded internal request headers plus the shared helper are the supported way to pass
 * authenticated context from middleware to App Router route handlers.
 */