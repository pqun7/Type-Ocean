import { spawnSync } from 'child_process';
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

(async function main() {
  const scriptPath = path.join('.', 'scripts', 'start-redis.sh');

  if (process.platform === 'win32') {
    // Try WSL first, then bash, then docker
    if (run('wsl', ['bash', scriptPath])) return process.exit(0);
    if (run('bash', [scriptPath])) return process.exit(0);
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
