import type { Rule } from 'eslint';

const pathModules = new Set(['path', 'node:path', 'node:path/posix', 'node:path/win32']);
const fsModules = new Set(['fs', 'node:fs', 'node:fs/promises', 'fs/promises']);

const createRule = (
  forbiddenModules: Set<string>,
  messageId: string,
  message: string,
): Rule.RuleModule => ({
  meta: {
    type: 'problem',
    messages: { [messageId]: message },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source === 'string' && forbiddenModules.has(source)) {
          context.report({ node, messageId });
        }
      },
    };
  },
});

const plugin = {
  meta: {
    name: 'prefer-effect',
  },
  rules: {
    'no-node-path': createRule(
      pathModules,
      'noNodePath',
      "Importing from 'node:path' is not allowed. Use `Path` from `effect` instead.",
    ),
    'no-node-fs': createRule(
      fsModules,
      'noNodeFs',
      "Importing from 'node:fs' is not allowed. Use `FileSystem` from `effect` instead.",
    ),
  },
};

export default plugin;
