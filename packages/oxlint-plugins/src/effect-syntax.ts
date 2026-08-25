import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { collectImports, hasAncestor, isFunctionNode, isMember, resolveMember } from './lib/ast.ts';

const noTryStatement: TSESLint.RuleModule<'tryStatement'> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      tryStatement:
        'try/catch/finally is not allowed. Wrap the throwing boundary with Effect.try or Effect.tryPromise.',
    },
  },
  defaultOptions: [],
  create: (context) => ({
    TryStatement: (node) => {
      context.report({ node, messageId: 'tryStatement' });
    },
  }),
};

type PromiseMessage = 'asyncFunction' | 'awaitExpression' | 'promiseValue';

const tryPromiseOnly: TSESLint.RuleModule<PromiseMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      asyncFunction:
        'async functions are only allowed as the function passed directly to Effect.tryPromise.',
      awaitExpression:
        'await is only allowed inside the function passed directly to Effect.tryPromise.',
      promiseValue:
        'Raw Promise values are only allowed inside the function passed directly to Effect.tryPromise.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    const adapters = new Set<TSESTree.Node>();
    const report = (node: TSESTree.Node, messageId: PromiseMessage) => {
      if (!hasAncestor(node, adapters)) {
        context.report({ node, messageId });
      }
    };
    const checkFunction = (node: TSESTree.Node & { readonly async: boolean }) => {
      if (node.async) {
        report(node, 'asyncFunction');
      }
    };
    return {
      CallExpression: (node) => {
        const resolved = resolveMember(node.callee, imports);
        if (resolved === undefined || !isMember(resolved, 'effect', 'Effect', 'tryPromise')) {
          return;
        }
        const [first] = node.arguments;
        if (first === undefined) {
          return;
        }
        if (isFunctionNode(first)) {
          adapters.add(first);
          return;
        }
        if (first.type === 'ObjectExpression') {
          for (const property of first.properties) {
            if (
              property.type === 'Property' &&
              !property.computed &&
              property.key.type === 'Identifier' &&
              property.key.name === 'try' &&
              isFunctionNode(property.value)
            ) {
              adapters.add(property.value);
            }
          }
        }
      },
      AwaitExpression: (node) => {
        report(node, 'awaitExpression');
      },
      ArrowFunctionExpression: checkFunction,
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      NewExpression: (node) => {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Promise' &&
          !imports.has('Promise')
        ) {
          report(node, 'promiseValue');
        }
      },
      MemberExpression: (node) => {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Promise' &&
          !imports.has('Promise')
        ) {
          report(node, 'promiseValue');
        }
      },
      TSTypeReference: (node) => {
        if (
          node.typeName.type === 'Identifier' &&
          (node.typeName.name === 'Promise' || node.typeName.name === 'PromiseLike')
        ) {
          report(node, 'promiseValue');
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'effect-syntax' },
  rules: {
    'no-try-statement': noTryStatement,
    'try-promise-only': tryPromiseOnly,
  },
};

export default plugin;
