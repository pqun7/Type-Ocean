// import { auth } from "@/lib/auth"
// import { NextResponse } from "next/server"

// export default auth(async (req) => {
//   const { pathname } = req.nextUrl

//   // التحقق من الصفحات المحمية
//   const protectedRoutes = ["/dashboard", "/profile"]
//   const isProtected = protectedRoutes.some(route => pathname.startsWith(route))

//   // إذا كان المستخدم غير مسجل الدخول
//   if (isProtected && !req.auth?.user) {
//     const loginUrl = new URL("/auth", req.url)
//     loginUrl.searchParams.set("callbackUrl", req.url)
//     return NextResponse.redirect(loginUrl)
//   }

//   // إذا كان البريد الإلكتروني غير مؤكد
//   if (req.auth?.user && !req.auth.user.emailVerified && pathname !== "/auth/verify") {
//     return NextResponse.redirect(new URL("/auth/verify", req.url))
//   }

//   return NextResponse.next()
// })

// export const config = {
//   matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
// }