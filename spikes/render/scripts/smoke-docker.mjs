#!/usr/bin/env node
/**
 * Phase 0 spike: `pnpm smoke:docker` — build the render image and run the
 * full render+verify pipeline inside it, then surface the verify report.
 *
 *   node scripts/smoke-docker.mjs [--keep]
 *
 * Requires a running Docker daemon. Exits non-zero if docker is missing,
 * the build/run fails, or any verify check fails.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = join(HERE, '..');
const REPO = join(SPIKE, '..', '..');
const OUT = join(SPIKE, 'out');
const IMAGE = 'motion-studio-render:phase0';

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  return r.status ?? 1;
}

// 1) docker available?
if (sh('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' }) !== 0) {
  console.error('docker daemon not reachable — start Docker and re-run `pnpm smoke:docker`.');
  process.exit(2);
}

// 2) build (context = repo root so packages/ + spikes/ are visible)
console.log('== docker build ==');
if (sh('docker', ['build', '-f', join(SPIKE, 'Dockerfile'), '-t', IMAGE, REPO]) !== 0) {
  console.error('docker build failed');
  process.exit(1);
}

// 3) run render-all + verify inside the container; outputs land in ./out
console.log('== docker run (render-all + verify) ==');
const outMount = process.platform === 'win32' ? OUT.replace(/\\/g, '/') : OUT;
if (sh('docker', ['run', '--rm', '-v', `${outMount}:/work/out`, IMAGE]) !== 0) {
  console.error('container run failed');
  process.exit(1);
}

// 4) surface the verify report written by the container
const reportPath = join(OUT, 'verify-report.json');
if (!existsSync(reportPath)) {
  console.error(`no verify-report.json at ${reportPath}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
console.log(`\n== verify report: ${report.passed}/${report.total} passed, ${report.failed} failed ==`);
for (const r of report.rows.filter((x) => !x.pass)) {
  console.log(`FAIL  ${r.fixture}  ${r.check}  — ${r.detail}`);
}
for (const c of report.negativeControls ?? []) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  neg:${c.name}  ${c.check} expect-fail — ${c.detail}`);
}
process.exit(report.failed > 0 ? 1 : 0);
