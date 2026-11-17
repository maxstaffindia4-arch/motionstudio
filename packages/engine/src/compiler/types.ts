/** Soft-rule finding returned by compileScene (A3). */
export interface CompileWarning {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  elementId?: string;
}

export type CompileTarget = 'preview' | 'render';

export interface CompileOptions {
  /** 'render' (default) omits previewOnly backgrounds; 'preview' includes them. */
  target?: CompileTarget;
}

export interface CompileResult {
  html: string;
  /** Local asset paths the caller must place next to index.html. */
  assets: string[];
  warnings: CompileWarning[];
}
