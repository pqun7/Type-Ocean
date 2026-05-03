import { spawnSync, execSync } from 'child_process';
import path from 'path';

function run(cmd, args) {
  console.log(`Running: ${cmd} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  return res && res.status === 0;
}

function dockerFallback() {
  console.log('Attempting Docker fallback: starting redis container...');
  return run('docker', ['run', '-d', '--name', 'type-space-redis', '-p', '6379:6379', 'redis:7-alpine']);
}

/**
 * On Windows + WSL2, Redis runs inside WSL2's private virtual network (e.g.
 * 172.x.x.x) and is NOT accessible via 127.0.0.1 from Windows unless a
 * portproxy rule exists. This function:
 *   1. Gets the current WSL2 eth0 IP.
 *   2. Removes any stale portproxy rule for port 6379.
 *   3. Adds a new rule: 127.0.0.1:6379 → <wsl2-ip>:6379.
 * Requires an elevated PowerShell process (UAC prompt will appear if needed).
 */
function setupWsl2PortForward() {
  let wslIp;
  try {
    wslIp = execSync("wsl bash -c \"ip addr show eth0 | grep -oP '(?<=inet )\\\\d+\\\\.\\\\d+\\\\.\\\\d+\\\\.\\\\d+'\"", { encoding: 'utf8' }).trim();
  } catch {
    console.warn('Could not determine WSL2 IP; skipping port-proxy setup.');
    return;
  }
  if (!wslIp || !/^\d+\.\d+\.\d+\.\d+$/.test(wslIp)) {
    console.warn(`Unexpected WSL2 IP value "${wslIp}"; skipping port-proxy setup.`);
    return;
  }

  console.log(`Setting up netsh portproxy: 127.0.0.1:6379 → ${wslIp}:6379`);
  const psScript = [
    `netsh interface portproxy delete v4tov4 listenport=6379 listenaddress=127.0.0.1 2>$null`,
    `netsh interface portproxy add v4tov4 listenport=6379 listenaddress=127.0.0.1 connectport=6379 connectaddress=${wslIp}`,
    `Write-Host "Port-proxy rule updated."`,
  ].join('; ');

  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command \\"${psScript}\\"' -Wait`],
    { stdio: 'inherit' },
  );
  if (!res || res.status !== 0) {
    console.warn('netsh portproxy setup may have failed. If Redis is unreachable from Windows, run as administrator:');
    console.warn(`  netsh interface portproxy add v4tov4 listenport=6379 listenaddress=127.0.0.1 connectport=6379 connectaddress=${wslIp}`);
  }
}

(async function main() {
  const scriptPath = path.join('.', 'scripts', 'start-redis.sh');

  if (process.platform === 'win32') {
    // Try WSL first, then bash, then docker
    if (run('wsl', ['bash', scriptPath])) {
      setupWsl2PortForward();
      return process.exit(0);
    }
    if (run('bash', [scriptPath])) {
      setupWsl2PortForward();
      return process.exit(0);
    }
    if (dockerFallback()) return process.exit(0);

    console.error('\nUnable to start Redis using WSL/bash/docker on this Windows system.');
    console.error('Please start Redis manually, or install WSL or Docker.');
    return process.exit(1);
  }

  // Non-Windows: try sh, then bash, then docker
  if (run('sh', [scriptPath])) return process.exit(0);
  if (run('bash', [scriptPath])) return process.exit(0);
  if (dockerFallback()) return process.exit(0);

  console.error('\nUnable to start Redis using sh/bash/docker. Start Redis manually and re-run this command.');
  process.exit(1);
})();
