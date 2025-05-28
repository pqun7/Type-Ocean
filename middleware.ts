// middleware.ts
import { auth } from "@/features/auth/lib/auth"
import { NextResponse, type NextRequest } from "next/server"
import { rateLimiter } from "@/lib/rate-limiter"
import { securityHeaders } from "@/lib/security-headers"
import { logger } from "@/log/ServerLogger"

// 1. قائمة بالنقاط الطرفية التي تحتاج Rate Limiting
const RATE_LIMITED_ENDPOINTS = [
  '/api/auth/login',
  '/api/auth/resend-verification',
  '/api/auth/reset-password',
  '/api/session-stats/v1'
]

// 2. قائمة بالمسارات المحمية
const PROTECTED_ROUTES = [
  "/dashboard",
  "/profile",
  "/settings"
]

export default auth(async (req, ctx) => {
  const { pathname } = req.nextUrl
  const ip = getClientIP(req)
  const userAgent = req.headers.get('user-agent') || 'unknown'

  // session is available as req.auth
  const session = req.auth

  try {
    // 3. تطبيق Rate Limiting على نقاط نهاية محددة
    if (RATE_LIMITED_ENDPOINTS.some(endpoint => pathname.startsWith(endpoint))) {
      const endpointConfig = RATE_LIMITED_ENDPOINTS.find(e => pathname.startsWith(e))!
      
      const { allowed, headers: rateLimitHeaders } = await rateLimiter.applyRateLimit(
        `${ip}-${userAgent}`, // استخدام مزيج من IP و User Agent كمعرف
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

    // 4. التحقق من الصفحات المحمية
    const isProtected = PROTECTED_ROUTES.some(route => pathname.startsWith(route))
    
    // 5. معالجة المستخدمين غير المسجلين
    if (isProtected && !session?.user) {
      const loginUrl = new URL("/auth", req.url)
      loginUrl.searchParams.set("callbackUrl", req.url)
      return redirectWithSecurity(loginUrl)
    }

    // 6. التحقق من البريد الإلكتروني المؤكد
    if (session?.user && !session.user.emailVerified && !pathname.startsWith('/auth/verify')) {
      return redirectWithSecurity(new URL("/auth/verify", req.url))
    }

    // 7. إضافة رؤوس الأمان وتحسينات الأداء
    const response = NextResponse.next()
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    // 8. تحسينات التخزين المؤقت للطلبات الثابتة
    if (pathname.startsWith('/_next/static')) {
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    }

    return response

  } catch (error) {
    logger.error('Middleware Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      pathname,
      ip,
      userAgent
    })

    // 9. الصفحة العامة للأخطاء في الإنتاج
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.redirect(new URL('/500', req.url))
    }

    return NextResponse.next()
  }
})

// 10. دالة مساعدة للحصول على IP العميل
function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anonymous'
  )
}

// 11. دالة مساعدة للتحويل مع الحفاظ على الرؤوس الأمنية
function redirectWithSecurity(url: URL): NextResponse {
  const response = NextResponse.redirect(url)
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

// 12. تكوين Middleware
export const config = {
  matcher: [
    "/((?!api/healthcheck|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"
  ]
}