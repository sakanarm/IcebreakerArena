// Runs the whole narrow-ui sweep in small batches of views and adds the results up.
//
// Why: every view is a browser page of its own, and a page that cannot get on the CPU measures the wrong moment.
// On this 8-core box, 13 pages at once put the in-page timers up to 2.5 s late and made the all-answered stamp
// miss its one-second window, which reads as a failure but is only the machine being short of cores. Four pages
// at a time keeps the timers inside 15 ms. Each batch plays its own game, so batches cannot disturb each other.
//
//   node sweep.mjs [base url] [--batch=4] [--only=normal|worst] [--shots]
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const run = promisify(execFile);

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BATCH = Math.max(1, Number(arg('batch', 4)));
const base = process.argv.slice(2).find((x) => !x.startsWith('--'));
const games = arg('only') ? [arg('only')] : ['normal', 'worst'];

// the view names as narrow-ui.mjs itself lists them, so the two cannot drift apart
const src = await readFile(new URL('./narrow-ui.mjs', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const VIEWS = ['), src.indexOf("\n];", src.indexOf('const VIEWS = [')));
const names = [...block.matchAll(/^\s*\['([^']+)'/gm)].map((m) => m[1]);
if (names.length < 2) throw new Error('could not read the view names out of narrow-ui.mjs');
const batches = Array.from({ length: Math.ceil(names.length / BATCH) }, (_, i) => names.slice(i * BATCH, i * BATCH + BATCH));
console.log(`${names.length} views in ${batches.length} batches of up to ${BATCH}, games: ${games.join(', ')}\n`);

let passed = 0;
const failures = [];
const broke = [];
for (const game of games)
  for (const [i, batch] of batches.entries()) {
    const tag = `${game} batch ${i + 1}/${batches.length}`;
    const args = ['narrow-ui.mjs', ...(base ? [base] : []), `--only=${game}`, `--views=${batch.join(',')}`, `--out=sweep-${game}-${i + 1}`];
    if (process.argv.includes('--shots')) args.push('--shots');
    const started = Date.now();
    let out = '';
    try {
      out = (await run(process.execPath, args, { cwd: here, maxBuffer: 64e6, env: { ...process.env, TIMING: '1' } })).stdout;
    } catch (e) {
      // a non-zero exit is how the harness reports failed checks; a crash has no tally and is reported apart
      out = (e.stdout ?? '') + (e.stderr ?? '');
      if (!/^\d+ passed/m.test(out)) broke.push(`${tag}: ${(e.message ?? '').split('\n')[0]}`);
    }
    passed += Number(out.match(/^(\d+) passed/m)?.[1] ?? 0);
    const mine = out.split('\n').filter((l) => l.startsWith('FAIL '));
    failures.push(...mine);
    const late = Math.max(0, ...[...out.matchAll(/late by up to (\d+) ms/g)].map((m) => +m[1]));
    console.log(`${tag}: ${batch.join(', ')}\n  ${mine.length ? `${mine.length} FAILED` : 'clean'}, timers late by up to ${late} ms, ${Math.round((Date.now() - started) / 1000)}s`);
  }

console.log(`\n${'='.repeat(60)}\n${passed} passed`);
if (broke.length) console.log(`${broke.length} batch(es) did not finish:\n  ${broke.join('\n  ')}`);
if (failures.length) console.log(`${failures.length} FAILED\n${failures.join('\n')}`);
else if (!broke.length) console.log('ALL PASSED');
process.exit(failures.length || broke.length ? 1 : 0);
