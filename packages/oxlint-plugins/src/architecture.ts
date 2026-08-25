import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { fileEndsWith } from './lib/ast.ts';

const NATIVE_PACKAGE = '@exsomnis/core';
const NATIVE_ADAPTER = 'apps/exsomnis/src/core-native.ts';

const isNativeSource = (source: string): boolean =>
  source === NATIVE_PACKAGE || source.startsWith(`${NATIVE_PACKAGE}/`);

const nativeCoreImport: TSESLint.RuleModule<'nativeImport'> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      nativeImport:
        'Import @exsomnis/core only from apps/exsomnis/src/core-native.ts. Depend on the CoreNative service elsewhere.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    if (fileEndsWith(context, NATIVE_ADAPTER)) {
      return {};
    }
    const checkSource = (node: TSESTree.Node, source: TSESTree.StringLiteral | null) => {
      if (source !== null && isNativeSource(source.value)) {
        context.report({ node, messageId: 'nativeImport' });
      }
    };
    return {
      ImportDeclaration: (node) => {
        checkSource(node, node.source);
      },
      ExportNamedDeclaration: (node) => {
        checkSource(node, node.source);
      },
      ExportAllDeclaration: (node) => {
        checkSource(node, node.source);
      },
      ImportExpression: (node) => {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          checkSource(node, node.source);
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'architecture' },
  rules: {
    'native-core-import': nativeCoreImport,
  },
};

export default plugin;
