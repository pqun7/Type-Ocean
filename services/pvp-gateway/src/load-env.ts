import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function isPathInside(baseDir: string, candidatePath: string) {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(candidatePath);

  // Windows: compare case-insensitively to avoid bypasses.
  const baseCmp = process.platform === "win32" ? base.toLowerCase() : base;
  const candidateCmp = process.platform === "win32" ? candidate.toLowerCase() : candidate;

  if (candidateCmp === baseCmp) return true;
  return candidateCmp.startsWith(baseCmp + path.sep);
}

function tryLoadEnvFile(baseDir: string, filePath: string) {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!isPathInside(baseDir, resolvedPath)) return;
    if (!fs.existsSync(resolvedPath)) return;
    dotenv.config({ path: resolvedPath, override: false });
  } catch {
    // ignore
  }
}

// dist runtime: .../services/pvp-gateway/dist
const gatewayDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(gatewayDir, "..", "..", "..");

// Match Next.js precedence: .env then .env.local
tryLoadEnvFile(repoRoot, path.join(repoRoot, ".env"));
tryLoadEnvFile(repoRoot, path.join(repoRoot, ".env.local"));

// Also support gateway-local env files
tryLoadEnvFile(gatewayDir, path.join(gatewayDir, ".env"));
tryLoadEnvFile(gatewayDir, path.join(gatewayDir, ".env.local"));
