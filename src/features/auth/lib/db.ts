import { db } from "@/db";

// Temporary compatibility export while callsites are migrated from Prisma API to Drizzle API.
export const prisma = db as unknown as any;

export default prisma;