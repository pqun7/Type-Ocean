import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function tryLoadEnvFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    dotenv.config({ path: filePath, override: false });
  } catch {
    // ignore
  }
}

// dist runtime: .../services/pvp-gateway/dist
const gatewayDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(gatewayDir, "..", "..", "..");

// Match Next.js precedence: .env then .env.local
tryLoadEnvFile(path.join(repoRoot, ".env"));
tryLoadEnvFile(path.join(repoRoot, ".env.local"));

// Also support gateway-local env files
tryLoadEnvFile(path.join(gatewayDir, ".env"));
tryLoadEnvFile(path.join(gatewayDir, ".env.local"));
