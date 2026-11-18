import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compileScene, type SceneSpec, type CompileResult } from '@motion-studio/engine';

const require = createRequire(import.meta.url);

/** Engine package assets dir (gsap.min.js etc.) — resolved via its entrypoint. */
export function engineAssetsDir(): string {
  const entry = require.resolve('@motion-studio/engine');
  // entry = <pkg>/src/index.ts → package root is one level up from src/
  return join(dirname(entry), '..', 'assets');
}

/** hyperframes CLI entry (bin/hyperframes.mjs inside the package). */
export function hyperframesBin(): string {
  const pkgJson = require.resolve('hyperframes/package.json');
  return join(dirname(pkgJson), 'bin', 'hyperframes.mjs');
}

export interface StagedComposition {
  /** Temp dir containing index.html + assets/. */
  dir: string;
  html: string;
  compile: CompileResult;
  cleanup: () => void;
}

/**
 * Compile a scene and stage it as a hyperframes composition dir
 * (index.html + assets/gsap.min.js) so `hyperframes lint` and a browser
 * can consume it. Caller MUST call cleanup() when done.
 */
export function stageScene(scene: SceneSpec | unknown, opts: { target?: 'preview' | 'render' } = {}): StagedComposition {
  const compile = compileScene(scene, opts);
  const dir = mkdtempSync(join(tmpdir(), 'ms-ai-stage-'));
  writeFileSync(join(dir, 'index.html'), compile.html);
  const assetsDir = join(dir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const engineAssets = engineAssetsDir();
  for (const asset of compile.assets) {
    const src = join(engineAssets, asset);
    if (existsSync(src)) copyFileSync(src, join(assetsDir, asset));
  }
  return {
    dir,
    html: compile.html,
    compile,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
