const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outPath = 'd:/Web projects/Type Space/type-space/logs/latest/jest_result.txt';
const cwd = 'd:/Web projects/Type Space/type-space';

try {
  const result = execSync(
    'node_modules\\.bin\\jest --testPathPattern=pvp-gateway --no-coverage --forceExit --ci',
    { cwd, timeout: 90000, encoding: 'utf8', shell: true }
  );
  fs.writeFileSync(outPath, result);
  process.stderr.write('Jest passed\n');
} catch (e) {
  const combined = (e.stdout || '') + '\n---STDERR---\n' + (e.stderr || '');
  fs.writeFileSync(outPath, combined);
  process.stderr.write('Jest returned non-zero: ' + e.status + '\n');
}
