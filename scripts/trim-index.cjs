const fs = require('fs');
const path = require('path');

const filePath = 'd:/Web projects/Type Space/type-space/services/pvp-gateway/src/index.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

process.stderr.write('Total lines before: ' + lines.length + '\n');

// Lines 3272-5461 (1-based) are the old handler body = indices [3271..5460] (0-based)
// We keep [0..3270] and [5461..]
const kept = [...lines.slice(0, 3271), ...lines.slice(5461)];

process.stderr.write('Total lines after: ' + kept.length + '\n');

fs.writeFileSync(filePath, kept.join('\n'), 'utf8');
process.stderr.write('Done!\n');
