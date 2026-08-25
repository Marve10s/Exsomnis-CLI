import type { TSESLint } from '@typescript-eslint/utils';
import { directiveKind } from './lib/directives.ts';

const noComments: TSESLint.RuleModule<'comment'> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      comment:
        'Comments are not allowed. Express the intent in names, types, or structure; only suppression directives with a reason may remain.',
    },
  },
  defaultOptions: [],
  create: (context) => ({
    Program: () => {
      for (const comment of context.sourceCode.getAllComments()) {
        if (directiveKind(comment.value) === undefined) {
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      }
    },
  }),
};

const plugin = {
  meta: { name: 'code-style' },
  rules: {
    'no-comments': noComments,
  },
};

export default plugin;
