import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import {
  collectImports,
  isFunctionNode,
  isMember,
  resolveMember,
  someDescendant,
} from './lib/ast.ts';

const SERIALIZER = 'serializeUnknownError';

const callsSerializer = (node: TSESTree.Node): boolean =>
  node.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === SERIALIZER) ||
    (node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === SERIALIZER));

type AdapterMessage = 'objectForm' | 'catchSerializer';

const adapterError: TSESLint.RuleModule<AdapterMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      objectForm: 'Effect.{{name}} must use the object form with try and catch properties.',
      catchSerializer:
        'The catch handler must route the caught value through serializeUnknownError.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    return {
      CallExpression: (node) => {
        const resolved = resolveMember(node.callee, imports);
        if (resolved === undefined) {
          return;
        }
        const isAdapter =
          isMember(resolved, 'effect', 'Effect', 'try') ||
          isMember(resolved, 'effect', 'Effect', 'tryPromise');
        if (!isAdapter) {
          return;
        }
        const [first] = node.arguments;
        if (first === undefined || first.type !== 'ObjectExpression') {
          context.report({ node, messageId: 'objectForm', data: { name: resolved.member } });
          return;
        }
        const properties = new Map<string, TSESTree.Property['value']>();
        for (const property of first.properties) {
          if (
            property.type === 'Property' &&
            !property.computed &&
            property.key.type === 'Identifier'
          ) {
            properties.set(property.key.name, property.value);
          }
        }
        const handler = properties.get('catch');
        if (!properties.has('try') || handler === undefined) {
          context.report({ node: first, messageId: 'objectForm', data: { name: resolved.member } });
          return;
        }
        if (!isFunctionNode(handler) || !someDescendant(handler, callsSerializer)) {
          context.report({ node: handler, messageId: 'catchSerializer' });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'effect-boundaries' },
  rules: {
    'adapter-error': adapterError,
  },
};

export default plugin;
