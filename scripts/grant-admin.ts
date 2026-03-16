import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../src/db";

type ParsedArgs = {
  email?: string;
  userId?: string;
  revoke: boolean;
  primary: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { revoke: false, primary: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--email") {
      parsed.email = argv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg === "--userId") {
      parsed.userId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg === "--revoke") {
      parsed.revoke = true;
    }

    if (arg === "--primary") {
      parsed.primary = true;
    }
  }

  return parsed;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run admin:grant -- --email you@example.com");
  console.log("  npm run admin:grant -- --userId <uuid>");
  console.log("  npm run admin:grant -- --email you@example.com --revoke");
  console.log("  npm run admin:grant -- --email you@example.com --primary");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if ((!args.email && !args.userId) || (args.email && args.userId)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const userResult = args.userId
    ? await db.execute<{ id: string; email: string; username: string; role: string; banned: boolean }>(sql`
        SELECT "id", "email", "username", "role", "banned"
        FROM "User"
        WHERE "id" = ${args.userId}
        LIMIT 1
      `)
    : await db.execute<{ id: string; email: string; username: string; role: string; banned: boolean }>(sql`
        SELECT "id", "email", "username", "role", "banned"
        FROM "User"
        WHERE "email" = ${args.email!}
        LIMIT 1
      `);
  const user = (userResult.rows?.[0] as
    | { id: string; email: string; username: string; role: string; banned: boolean }
    | undefined) ?? null;

  if (!user) {
    console.error("User not found.");
    process.exitCode = 1;
    return;
  }

  const nextRole = args.revoke ? "user" : "admin";

  await db.transaction(async (tx) => {
    if (args.primary && !args.revoke) {
      await tx.execute(sql`
        UPDATE "User"
        SET "isPrimaryAdmin" = FALSE,
            "updatedAt" = NOW()
        WHERE "isPrimaryAdmin" = TRUE
      `);
    }

    await tx.execute(sql`
      UPDATE "User"
      SET "role" = ${nextRole},
          "isPrimaryAdmin" = ${args.revoke ? false : args.primary},
          "updatedAt" = NOW()
      WHERE "id" = ${user.id}
    `);
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        action: args.revoke ? "revoked_admin" : "granted_admin",
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          previousRole: user.role,
          newRole: nextRole,
          isPrimaryAdmin: args.revoke ? false : args.primary,
          banned: user.banned,
        },
      },
      null,
      2
    )
  );
}

void main()
  .catch((error) => {
    console.error("Failed to update admin role.");
    console.error(error);
    process.exitCode = 1;
  });