/* eslint-disable @typescript-eslint/no-require-imports */
// One-time cleanup script: removes the duplicate old code section from usePvpSocket.tsx
// The file has the new section (lines 1-735) and old duplicate section (lines 736+).
// We keep up to and including the closing } of the new usePvpSocket hook.
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/features/pvp/client/usePvpSocket.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find the second occurrence of "MAX_RECONNECT_ATTEMPTS = 3" which is only in old code
const oldSectionLineIdx = lines.findIndex(l => l.includes('MAX_RECONNECT_ATTEMPTS = 3'));
if (oldSectionLineIdx === -1) {
  console.log('No duplicate section found — file may already be clean.');
  process.exit(0);
}

// Walk backward from oldSectionLineIdx to find the blank lines before the old /* Types */ section
// The old section starts with blank lines + /* --- */ comment, typically 7 lines before MAX_RECONNECT_ATTEMPTS
// Find the first blank line going backward from oldSectionLineIdx
let cutAt = oldSectionLineIdx;
while (cutAt > 0 && lines[cutAt - 1].trim() === '') {
  cutAt--;
}
// cutAt now points to the last non-blank line before the old section (the closing } of new usePvpSocket)
// We want to KEEP up to and including that line

const kept = lines.slice(0, cutAt + 1);
const newContent = kept.join('\n') + '\n';
fs.writeFileSync(filePath, newContent, 'utf8');
console.log(`Done. Kept ${kept.length} lines (removed ${lines.length - kept.length} lines from line ${cutAt + 2} onward).`);
