import type { SceneSpec, CanvasSpec, Anchor } from '@motion-studio/engine';
import type { ProviderRef } from './providers/index.js';
import type { TokenUsage } from './providers/index.js';

export type { ProviderRef, ProviderKind, TokenUsage } from './providers/index.js';
export { AiError, isNonRepairable } from './providers/errors.js';
export type { ProviderErrorKind } from './providers/errors.js';
export { FakeProvider } from './providers/fake.js';
export type { FakeScriptEntry, FakeCall } from './providers/fake.js';
export { generateStructured, testConnection, toAiError } from './providers/index.js';
export type { GenerateStructuredArgs, StructuredResult, ConnectionResult, ChatMessage } from './providers/index.js';

// ---------------------------------------------------------------------------
// generation I/O
// ---------------------------------------------------------------------------

export type CanvasPresetName = 'landscape' | 'vertical' | 'square';

export interface GenerationSettings {
  canvas:
    | { preset: CanvasPresetName }
    | { preset: 'custom'; width: number; height: number };
  /** Seconds; default 5, clamped to [1, 30]. */
  durationSec?: number;
  /** Frames per second; default 30. */
  fps?: number;
  output: 'transparent' | 'opaque';
  safeMargins?: 'off' | 'title' | 'action';
  /** Style hint only — the model may honor or ignore. */
  background?: 'none' | 'dark' | 'light' | 'gradient';
  /** Preferred anchor placement hint. */
  anchor?: Anchor;
  /** Motion intensity → engine tokens.motion. */
  motion?: 'subtle' | 'standard' | 'punchy';
}

export interface ProjectMemoryFile {
  name: string;
  mode: 'full' | 'summary' | 'off';
  content: string;
}

export interface ProjectMemory {
  instructions?: string;
  files?: ProjectMemoryFile[];
}

export interface PreviousScene {
  scene: SceneSpec;
  instruction: string;
}

export interface GenerationInput {
  prompt: string;
  settings: GenerationSettings;
  projectMemory?: ProjectMemory;
  previous?: PreviousScene;
  /** Extra verbatim strings that must appear in the compiled DOM text. */
  lockedText?: string[];
}

export type GenerationStrategy = 'auto' | 'llm' | 'template';

export type StageName = 'route' | 'generate' | 'validate' | 'compile' | 'lint' | 'layout-qa' | 'verbatim' | 'repair' | 'template';

export interface StageInfo {
  stage: StageName;
  latencyMs: number;
  attempt?: number;
  inputTokens?: number;
  outputTokens?: number;
  detail?: string;
}

export type OnStage = (stage: StageName, info: StageInfo) => void;

export interface GenerationIssue {
  severity: 'error' | 'warning';
  stage: 'schema' | 'scene' | 'compile' | 'lint' | 'layout-qa' | 'verbatim' | 'manual-guard';
  message: string;
  elementId?: string;
}

export interface StageMetrics {
  stage: StageName;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  detail?: string;
}

export interface GenerationResult {
  status: 'ok' | 'needs_review';
  scene: SceneSpec;
  html: string;
  issues: GenerationIssue[];
  repairAttempts: number;
  usage: TokenUsage;
  stages: StageMetrics[];
  /** Which strategy produced the final scene. */
  strategy: 'llm' | 'template';
  /** True when the template fallback produced the result after LLM failure. */
  fellBackToTemplate?: boolean;
  route: { component?: string; confidence: number; reason: string };
}

export interface GenerateAnimationOptions {
  /** Provider config OR a FakeProvider instance. */
  provider: ProviderRef;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** 'llm' (default) | 'template' | 'auto' (currently aliases 'llm'). */
  strategy?: GenerationStrategy;
  /** Run layout QA (Playwright). Default true. */
  qa?: boolean;
  /** Max repair passes. Default 2. */
  maxRepairs?: number;
  /** Per-stage timeouts (ms). Defaults: generate 120s, others 60s. */
  timeouts?: Partial<Record<'generate' | 'lint' | 'layout-qa', number>>;
  onStage?: OnStage;
  signal?: AbortSignal;
}
