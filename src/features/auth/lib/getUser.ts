// Placeholder auth integration. Replace with real session logic (e.g. NextAuth).
export interface AuthUser {
  id: string;
  roles: string[];
}

export async function getAuthenticatedUser(req: Request): Promise<AuthUser | null> {
  // Example: derive from cookies / server session
  // const session = await auth();
  // if (!session?.user) return null;
  // return { id: session.user.id, roles: session.user.roles ?? [] };
  const header = req.headers.get('x-internal-auth'); // temporary fallback
  if (!header) return null;
  return { id: header, roles: [] };
}
