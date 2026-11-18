import { spawn } from 'node:child_process';
import { hyperframesBin } from './stage.js';
import type { SceneSpec } from '@motion-studio/engine';
import { stageScene } from './stage.js';

/** A lint finding normalized from `hyperframes lint --json`. */
export interface LintFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  elementId?: string;
  fixHint?: string;
}

export interface LintResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: LintFinding[];
}

interface RawFinding {
  code?: string;
  severity?: string;
  message?: string;
  file?: string;
  elementId?: string;
  fixHint?: string;
}

interface RawLintOutput {
  ok?: boolean;
  errorCount?: number;
  warningCount?: number;
  findings?: RawFinding[];
  error?: { message?: string };
}

function runLint(dir: string, timeoutMs: number): Promise<RawLintOutput> {
  return new Promise((resolve, reject) => {
    const bin = hyperframesBin();
    const child = spawn(process.execPath, [bin, 'lint', '--json', dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hyperframes lint timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // hyperframes prints JSON to stdout; stderr may carry progress noise.
      const text = out.trim();
      const jsonStart = text.indexOf('{');
      if (jsonStart === -1) {
        reject(new Error(`hyperframes lint produced no JSON (exit ${code}): ${err.slice(0, 300) || text.slice(0, 300)}`));
        return;
      }
      try {
        resolve(JSON.parse(text.slice(jsonStart)) as RawLintOutput);
      } catch (e) {
        reject(new Error(`hyperframes lint JSON parse failed: ${(e as Error).message}`));
      }
    });
  });
}

/**
 * Compile a scene, stage it, and run `hyperframes lint --json`.
 * Lint findings become normalized LintFindings; spawn/parse failures throw.
 */
export async function lintScene(
  scene: SceneSpec | unknown,
  opts: { timeoutMs?: number; target?: 'preview' | 'render' } = {}
): Promise<{ html: string; compileWarnings: { code: string; severity: string; message: string; elementId?: string }[]; lint: LintResult; cleanup: () => void }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const staged = stageScene(scene, opts.target !== undefined ? { target: opts.target } : {});
  try {
    const raw = await runLint(staged.dir, timeoutMs);
    const findings: LintFinding[] = (raw.findings ?? []).map((f) => ({
      code: f.code ?? 'unknown',
      severity: (f.severity === 'error' ? 'error' : f.severity === 'info' ? 'info' : 'warning') as LintFinding['severity'],
      message: f.message ?? '',
      ...(f.file !== undefined ? { file: f.file } : {}),
      ...(f.elementId !== undefined ? { elementId: f.elementId } : {}),
      ...(f.fixHint !== undefined ? { fixHint: f.fixHint } : {}),
    }));
    return {
      html: staged.html,
      compileWarnings: staged.compile.warnings,
      lint: {
        ok: raw.ok ?? raw.errorCount === 0,
        errorCount: raw.errorCount ?? findings.filter((f) => f.severity === 'error').length,
        warningCount: raw.warningCount ?? findings.filter((f) => f.severity === 'warning').length,
        findings,
      },
      cleanup: staged.cleanup,
    };
  } catch (e) {
    staged.cleanup();
    throw e;
  }
}
