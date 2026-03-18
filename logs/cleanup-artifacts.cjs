#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');

const logsDir = path.resolve(__dirname);
const latestDir = path.join(logsDir, 'latest');

function parseArgs(argv) {
  const args = {
    keep: 1,
    dryRun: false,
    quiet: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--quiet') args.quiet = true;
    if (arg.startsWith('--keep=')) {
      const value = Number(arg.slice('--keep='.length));
      if (Number.isFinite(value) && value >= 1) {
        args.keep = Math.floor(value);
      }
    }
  }

  return args;
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .map((name) => {
      const fullPath = path.join(dirPath, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, stat };
    })
    .filter((entry) => entry.stat.isFile());
}

function collectByPattern(files, pattern) {
  return files
    .filter((entry) => pattern.test(entry.name))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function removeFiles(filesToRemove, dryRun) {
  for (const entry of filesToRemove) {
    if (!dryRun) {
      fs.unlinkSync(entry.fullPath);
    }
  }
}

function cleanupFamily({ files, keep, pattern, dryRun, summary, familyName }) {
  const matches = collectByPattern(files, pattern);
  const keepList = matches.slice(0, keep);
  const removeList = matches.slice(keep);

  removeFiles(removeList, dryRun);

  summary.push({
    family: familyName,
    total: matches.length,
    kept: keepList.map((entry) => entry.name),
    removed: removeList.map((entry) => entry.name),
  });
}

function cleanupLegacyStrictFiles({ files, dryRun, summary }) {
  const legacyPattern = /^k6_strict_(run\d+|robust)\.txt$/;
  const legacy = files
    .filter((entry) => legacyPattern.test(entry.name))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  removeFiles(legacy, dryRun);

  summary.push({
    family: 'k6_legacy_strict',
    total: legacy.length,
    kept: [],
    removed: legacy.map((entry) => entry.name),
  });
}

function printSummary(summary, quiet, dryRun) {
  if (quiet) return;
  const mode = dryRun ? 'DRY-RUN' : 'APPLIED';
  console.log(`[cleanup-artifacts] ${mode}`);
  for (const item of summary) {
    console.log(`- ${item.family}: total=${item.total}, removed=${item.removed.length}`);
    if (item.removed.length > 0) {
      for (const name of item.removed) {
        console.log(`  remove: ${name}`);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (String(process.env.PVP_SKIP_LOG_CLEANUP || '').toLowerCase() === 'true') {
    if (!args.quiet) {
      console.log('[cleanup-artifacts] skipped by PVP_SKIP_LOG_CLEANUP=true');
    }
    return;
  }

  const files = listFiles(logsDir);
  const latestFiles = listFiles(latestDir);
  const summary = [];

  cleanupFamily({
    files,
    keep: args.keep,
    pattern: /^k6_strict_\d{8}_\d{6}\.txt$/,
    dryRun: args.dryRun,
    summary,
    familyName: 'k6_strict_timestamped',
  });

  cleanupLegacyStrictFiles({ files, dryRun: args.dryRun, summary });

  cleanupFamily({
    files,
    keep: args.keep,
    pattern: /^gateway_strict_run\d+\.log$/,
    dryRun: args.dryRun,
    summary,
    familyName: 'gateway_strict_runs',
  });

  cleanupFamily({
    files: latestFiles,
    keep: 1,
    pattern: /^k6_.*\.txt$/,
    dryRun: args.dryRun,
    summary,
    familyName: 'latest_k6_outputs',
  });

  cleanupFamily({
    files: latestFiles,
    keep: 1,
    pattern: /^pg_stat_statements_after_window\.json$/,
    dryRun: args.dryRun,
    summary,
    familyName: 'latest_pg_after',
  });

  cleanupFamily({
    files: latestFiles,
    keep: 1,
    pattern: /^pg_stat_statements_before_window\.json$/,
    dryRun: args.dryRun,
    summary,
    familyName: 'latest_pg_before',
  });

  printSummary(summary, args.quiet, args.dryRun);
}

main();
