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

const repoRoot = process.cwd();
const sourceGatewayDir = path.resolve(repoRoot, "services", "pvp-gateway");
const runtimeGatewayDir = path.resolve(__dirname, "..");

const candidateBaseDirs = [sourceGatewayDir, repoRoot, runtimeGatewayDir].filter(
  (baseDir, index, all) => all.indexOf(baseDir) === index
);

// First-loaded value wins (dotenv override=false). Keep gateway-specific files first
// so start/build can use dedicated values without clobbering shell-provided env.
const envFileOrder = [
  ".env.gateway.local",
  ".env.gateway",
  ".env.local",
  ".env",
] as const;

for (const fileName of envFileOrder) {
  for (const baseDir of candidateBaseDirs) {
    tryLoadEnvFile(baseDir, path.join(baseDir, fileName));
  }
}
