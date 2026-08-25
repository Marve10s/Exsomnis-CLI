import type { Rule } from 'eslint';

const lintDisablePattern = /^\s*(eslint-disable|oxlint-disable)(-next-line|-line)?\b/;
const tsDirectivePattern = /^\s*@ts-(ignore|expect-error|nocheck)\b/;

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require descriptions on eslint-disable, oxlint-disable, @ts-ignore, and @ts-expect-error comments',
    },
    messages: {
      missingLintDescription:
        'Disable directive is missing a description. Add one after "--" (e.g., "// oxlint-disable-next-line rule-name -- reason here").',
      missingTsDescription:
        'TypeScript directive is missing a description. Add one after the directive (e.g., "// @ts-expect-error -- reason here").',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (lintDisablePattern.test(text) && !text.includes('--')) {
            context.report({
              // oxlint-disable-next-line unknown-cast/forbidden, typescript/no-unsafe-type-assertion -- ESLint Comment type lacks loc/range but context.report accepts it
              node: comment as unknown as Rule.Node,
              messageId: 'missingLintDescription',
            });
            continue;
          }
          const tsMatch = tsDirectivePattern.exec(text);
          if (!tsMatch) continue;
          const afterDirective = text.slice(text.indexOf(tsMatch[0]) + tsMatch[0].length);
          const hasDescription =
            afterDirective.includes('--') ||
            afterDirective.includes(':') ||
            /\s+\S/.test(afterDirective);
          if (!hasDescription) {
            context.report({
              // oxlint-disable-next-line unknown-cast/forbidden, typescript/no-unsafe-type-assertion -- ESLint Comment type lacks loc/range but context.report accepts it
              node: comment as unknown as Rule.Node,
              messageId: 'missingTsDescription',
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'disable-comments',
  },
  rules: {
    'require-description': rule,
  },
};

export default plugin;
