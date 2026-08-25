const LINT_DIRECTIVE = /^\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?\b/u;
const TS_DIRECTIVE = /^\s*@ts-(?:ignore|expect-error|nocheck|check)\b/u;
const EFFECT_DIRECTIVE = /^\s*@effect-diagnostics(?:-next-line)?\b/u;
const REASON = /\s--\s+\S{3,}/u;

export type DirectiveKind = 'lint' | 'typescript' | 'effect';

export const directiveKind = (comment: string): DirectiveKind | undefined => {
  if (LINT_DIRECTIVE.test(comment)) {
    return 'lint';
  }
  if (TS_DIRECTIVE.test(comment)) {
    return 'typescript';
  }
  if (EFFECT_DIRECTIVE.test(comment)) {
    return 'effect';
  }
  return undefined;
};

export const hasReason = (comment: string): boolean => REASON.test(comment);
