#!/usr/bin/env node
/**
 * Reusable multi-provider launcher for the burst-100k benchmark.
 *
 * Provisions one Namespace VM per provider via scripts/burst-100k-launch.sh,
 * sequentially. Each VM runs the coordinator independently after this script
 * returns — see the RUN_IDs printed at the end to monitor with:
 *
 *   psql "$PG_URL" -c "SELECT id, status, sandboxes_succeeded, partials,
 *                             readiness_failures, timeouts+http_errors+network_errors AS failed
 *                      FROM runs WHERE id IN (...);"
 *
 * Loads .env via dotenv (not shell sourcing) so inline `// comment` syntax in
 * values is treated as part of the value — same as the runtime would see it.
 *
 * Usage:
 *   tsx scripts/burst-100k-launch-multi.ts
 *   tsx scripts/burst-100k-launch-multi.ts --providers e2b,modal --concurrency 100 --duration 30m
 *   npm run bench:burst-100k:multi
 *   npm run bench:burst-100k:multi -- --providers e2b,modal -c 100
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROVIDERS = ['e2b', 'modal', 'runloop', 'tensorlake', 'declaw'];

interface Args {
  providers: string[];
  concurrency: string;
  duration: string;
  machineType?: string;
}

function usage(): string {
  return [
    'Usage: tsx scripts/burst-100k-launch-multi.ts [options]',
    '',
    'Options:',
    '  --providers <list>     Comma-separated provider list',
    `                         (default: ${DEFAULT_PROVIDERS.join(',')})`,
    '  --concurrency <n>, -c  Sandboxes per provider (default: 1000)',
    '  --duration <dur>       Namespace VM lifetime per launch (default: 1h)',
    '  --machine-type <type>  Namespace machine type (default: launch.sh default)',
    '  --help, -h             Print this help',
    '',
    'Examples:',
    '  npm run bench:burst-100k:multi',
    '  npm run bench:burst-100k:multi -- --providers e2b,modal -c 100',
  ].join('\n');
}

function parseArgs(): Args {
  const out: Args = { providers: DEFAULT_PROVIDERS, concurrency: '1000', duration: '1h' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`missing value for ${a}`);
        process.exit(2);
      }
      return v;
    };
    if (a === '--providers') {
      out.providers = next().split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--concurrency' || a === '-c') {
      out.concurrency = next();
    } else if (a === '--duration') {
      out.duration = next();
    } else if (a === '--machine-type') {
      out.machineType = next();
    } else if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}\n${usage()}`);
      process.exit(2);
    }
  }
  if (!/^\d+$/.test(out.concurrency)) {
    console.error(`--concurrency must be a positive integer (got: ${out.concurrency})`);
    process.exit(2);
  }
  return out;
}

const args = parseArgs();
const launchScript = path.resolve(__dirname, 'burst-100k-launch.sh');

const horizontalRule = '═'.repeat(67);
console.log(`Launching ${args.providers.length} provider(s) × ${args.concurrency} sandboxes`);
console.log(`  providers: ${args.providers.join(', ')}`);
console.log(`  duration:  ${args.duration}`);
if (args.machineType) console.log(`  machine:   ${args.machineType}`);
console.log('');

const summary: Array<{ provider: string; rc: number }> = [];
for (const provider of args.providers) {
  console.log(horizontalRule);
  console.log(` launching ${provider}`);
  console.log(horizontalRule);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROVIDER: provider,
    CONCURRENCY_TARGET: args.concurrency,
    DURATION: args.duration,
  };
  if (args.machineType) env.MACHINE_TYPE = args.machineType;
  const res = spawnSync('bash', [launchScript], { stdio: 'inherit', env });
  summary.push({ provider, rc: res.status ?? 1 });
  console.log('');
}

console.log(horizontalRule);
console.log(' summary');
console.log(horizontalRule);
let failed = 0;
for (const s of summary) {
  const tag = s.rc === 0 ? 'OK' : `FAIL(rc=${s.rc})`;
  console.log(`  ${s.provider.padEnd(15)} ${tag}`);
  if (s.rc !== 0) failed++;
}
if (failed > 0) {
  console.log(`\n${failed}/${summary.length} launches failed`);
  process.exit(1);
}
