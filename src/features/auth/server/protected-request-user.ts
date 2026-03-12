import type { NextRequest } from "next/server"

export const AUTH_USER_ID_HEADER = "x-auth-user-id"
export const AUTH_USER_EMAIL_HEADER = "x-auth-user-email"
export const AUTH_USER_ROLE_HEADER = "x-auth-user-role"

export type ProtectedRequestUser = {
  id: string
  email: string
  role: string
}

export function buildProtectedRequestUserHeaders(user: ProtectedRequestUser, source?: Headers): Headers {
  const headers = new Headers(source)

  headers.delete(AUTH_USER_ID_HEADER)
  headers.delete(AUTH_USER_EMAIL_HEADER)
  headers.delete(AUTH_USER_ROLE_HEADER)

  headers.set(AUTH_USER_ID_HEADER, user.id)
  headers.set(AUTH_USER_EMAIL_HEADER, user.email)
  headers.set(AUTH_USER_ROLE_HEADER, user.role)

  return headers
}

export function readProtectedRequestUser(
  reqOrHeaders: NextRequest | Headers
): ProtectedRequestUser | null {
  const headers = reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders.headers

  const id = headers.get(AUTH_USER_ID_HEADER)
  const email = headers.get(AUTH_USER_EMAIL_HEADER)
  const role = headers.get(AUTH_USER_ROLE_HEADER)

  if (!id || !email || !role) {
    return null
  }

  return { id, email, role }
}

export function requireProtectedRequestUser(
  reqOrHeaders: NextRequest | Headers
): ProtectedRequestUser {
  const user = readProtectedRequestUser(reqOrHeaders)
  if (!user) {
    throw new Error("MISSING_PROTECTED_REQUEST_USER")
  }

  return user
}