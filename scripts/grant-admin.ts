import "dotenv/config";

import prisma from "../src/features/auth/lib/db";

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

  const where = args.userId ? { id: args.userId } : { email: args.email };
  const user = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      banned: true,
    },
  });

  if (!user) {
    console.error("User not found.");
    process.exitCode = 1;
    return;
  }

  const nextRole = args.revoke ? "user" : "admin";

  await prisma.$transaction(async (tx) => {
    if (args.primary && !args.revoke) {
      await tx.user.updateMany({
        where: { isPrimaryAdmin: true },
        data: { isPrimaryAdmin: false },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        role: nextRole,
        isPrimaryAdmin: args.revoke ? false : args.primary,
      },
    });
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
  })
  .finally(async () => {
    await prisma.$disconnect();
  });