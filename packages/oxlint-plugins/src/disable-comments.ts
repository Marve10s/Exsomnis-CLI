import type { TSESLint } from '@typescript-eslint/utils';
import { directiveKind, hasReason } from './lib/directives.ts';

const requireDescription: TSESLint.RuleModule<'missingReason'> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missingReason:
        'A {{kind}} suppression must explain itself: add " -- <reason>" after the directive.',
    },
  },
  defaultOptions: [],
  create: (context) => ({
    Program: () => {
      for (const comment of context.sourceCode.getAllComments()) {
        const kind = directiveKind(comment.value);
        if (kind !== undefined && !hasReason(comment.value)) {
          context.report({ loc: comment.loc, messageId: 'missingReason', data: { kind } });
        }
      }
    },
  }),
};

const plugin = {
  meta: { name: 'disable-comments' },
  rules: {
    'require-description': requireDescription,
  },
};

export default plugin;
