import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import {
  collectImports,
  fileEndsWith,
  heritageBase,
  isGlobalReference,
  isMember,
  isReferencePosition,
  resolveMember,
} from './lib/ast.ts';

const ENTRYPOINT = 'apps/exsomnis/src/bin.ts';

type ServiceMessage =
  | 'functionStyle'
  | 'forbiddenApi'
  | 'anonymousService'
  | 'keyLiteral'
  | 'keyName'
  | 'missingMake'
  | 'accessors'
  | 'missingLayer';

const contextServiceContract: TSESLint.RuleModule<ServiceMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      functionStyle:
        'Services must use the class-style Context.Service<Self, Shape>()(key, { make }).',
      forbiddenApi: '{{name}} is not allowed. Define the service with class-style Context.Service.',
      anonymousService: 'A service class must have a name so its key can match it.',
      keyLiteral: 'The service key must be a string literal.',
      keyName: 'The service key must end with the class name.',
      missingMake: 'The service options must declare a make effect.',
      accessors:
        'Generated accessors and Default layers are not allowed. Declare an explicit static layer.',
      missingLayer: 'The service must declare a static layer.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    const isContextService = (node: TSESTree.Expression) => {
      const resolved = resolveMember(node, imports);
      return resolved !== undefined && isMember(resolved, 'effect', 'Context', 'Service');
    };
    const forbiddenName = (node: TSESTree.Expression): string | undefined => {
      const resolved = resolveMember(node, imports);
      if (resolved === undefined) {
        return undefined;
      }
      if (isMember(resolved, 'effect', 'Effect', 'Service')) {
        return 'Effect.Service';
      }
      if (isMember(resolved, 'effect', 'Effect', 'Tag')) {
        return 'Effect.Tag';
      }
      if (isMember(resolved, 'effect', 'Context', 'Tag')) {
        return 'Context.Tag';
      }
      return undefined;
    };
    return {
      CallExpression: (node) => {
        if (isContextService(node.callee) && node.arguments.length > 0) {
          context.report({ node, messageId: 'functionStyle' });
        }
        const name = forbiddenName(node.callee);
        if (name !== undefined) {
          context.report({ node, messageId: 'forbiddenApi', data: { name } });
        }
      },
      ClassDeclaration: (node) => {
        const heritage = node.superClass;
        if (heritage === null || heritage.type !== 'CallExpression') {
          return;
        }
        const inner = heritage.callee;
        if (inner.type !== 'CallExpression' || !isContextService(inner.callee)) {
          return;
        }
        if (node.id === null) {
          context.report({ node, messageId: 'anonymousService' });
          return;
        }
        const className = node.id.name;
        const [key, options] = heritage.arguments;
        if (key === undefined || key.type !== 'Literal' || typeof key.value !== 'string') {
          context.report({ node: key ?? heritage, messageId: 'keyLiteral' });
        } else if (!key.value.endsWith(`/${className}`)) {
          context.report({ node: key, messageId: 'keyName' });
        }
        if (options === undefined || options.type !== 'ObjectExpression') {
          context.report({ node: options ?? heritage, messageId: 'missingMake' });
        } else {
          const names = new Set(
            options.properties.flatMap((property) =>
              property.type === 'Property' &&
              !property.computed &&
              property.key.type === 'Identifier'
                ? [property.key.name]
                : [],
            ),
          );
          if (!names.has('make')) {
            context.report({ node: options, messageId: 'missingMake' });
          }
          if (names.has('accessors')) {
            context.report({ node: options, messageId: 'accessors' });
          }
        }
        const hasLayer = node.body.body.some(
          (member) =>
            member.type === 'PropertyDefinition' &&
            member.static &&
            !member.computed &&
            member.key.type === 'Identifier' &&
            member.key.name === 'layer',
        );
        if (!hasLayer) {
          context.report({ node: node.id, messageId: 'missingLayer' });
        }
      },
    };
  },
};

type ErrorMessage =
  | 'nativeError'
  | 'dataTaggedError'
  | 'mustExtendSchema'
  | 'throwStatement'
  | 'newError';

const schemaTaggedErrors: TSESLint.RuleModule<ErrorMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      nativeError:
        'Application failures must extend Schema.TaggedError, not the native Error class.',
      dataTaggedError: 'Application failures must extend Schema.TaggedError, not Data.TaggedError.',
      mustExtendSchema: 'A class named *Error must extend Schema.TaggedError.',
      throwStatement:
        'throw is not allowed. Fail with a Schema.TaggedError through the Effect error channel.',
      newError:
        'new Error is not allowed. Fail with a Schema.TaggedError through the Effect error channel.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    return {
      ClassDeclaration: (node) => {
        const heritage = node.superClass;
        const base = heritage === null ? undefined : heritageBase(heritage);
        const resolved = base === undefined ? undefined : resolveMember(base, imports);
        if (base !== undefined && isGlobalReference(base, 'Error', imports)) {
          context.report({ node: base, messageId: 'nativeError' });
        }
        if (resolved !== undefined && isMember(resolved, 'effect', 'Data', 'TaggedError')) {
          context.report({ node: base ?? node, messageId: 'dataTaggedError' });
        }
        const extendsSchema =
          resolved !== undefined && isMember(resolved, 'effect', 'Schema', 'TaggedError');
        if (node.id !== null && node.id.name.endsWith('Error') && !extendsSchema) {
          context.report({ node: node.id, messageId: 'mustExtendSchema' });
        }
      },
      ThrowStatement: (node) => {
        context.report({ node, messageId: 'throwStatement' });
      },
      NewExpression: (node) => {
        if (isGlobalReference(node.callee, 'Error', imports)) {
          context.report({ node, messageId: 'newError' });
        }
      },
    };
  },
};

type ErasureMessage = 'orDie' | 'genericCatch' | 'catchCause';

const noErrorErasure: TSESLint.RuleModule<ErasureMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      orDie:
        'Effect.orDie hides a typed failure. Recover with catchTag or catchTags, or let the failure propagate.',
      genericCatch:
        'Generic Effect.catch is only allowed at the entrypoint. Recover with catchTag or catchTags.',
      catchCause:
        'Effect.catchCause is reserved for infrastructure boundaries. Disable this rule inline with a reason if this is one.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    const isEntrypoint = fileEndsWith(context, ENTRYPOINT);
    const check = (node: TSESTree.Expression) => {
      const resolved = resolveMember(node, imports);
      if (resolved === undefined) {
        return;
      }
      if (
        isMember(resolved, 'effect', 'Effect', 'orDie') ||
        isMember(resolved, 'effect', 'Effect', 'orDieWith')
      ) {
        context.report({ node, messageId: 'orDie' });
      } else if (isMember(resolved, 'effect', 'Effect', 'catch') && !isEntrypoint) {
        context.report({ node, messageId: 'genericCatch' });
      } else if (isMember(resolved, 'effect', 'Effect', 'catchCause')) {
        context.report({ node, messageId: 'catchCause' });
      }
    };
    return {
      MemberExpression: check,
      Identifier: (node) => {
        if (isReferencePosition(node)) {
          check(node);
        }
      },
    };
  },
};

const RUNNERS = new Set([
  'runFork',
  'runForkWith',
  'runPromise',
  'runPromiseWith',
  'runPromiseExit',
  'runPromiseExitWith',
  'runSync',
  'runSyncWith',
  'runSyncExit',
  'runSyncExitWith',
]);

type RuntimeMessage = 'runner' | 'runMainLocation' | 'runMainCount';

const runtimeBoundary: TSESLint.RuleModule<RuntimeMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      runner: 'Effects run once through BunRuntime.runMain in bin.ts. Do not call Effect.{{name}}.',
      runMainLocation: 'BunRuntime.runMain is only allowed in apps/exsomnis/src/bin.ts.',
      runMainCount: 'BunRuntime.runMain may be called only once.',
    },
  },
  defaultOptions: [],
  create: (context) => {
    const imports = collectImports(context.sourceCode.ast);
    const isEntrypoint = fileEndsWith(context, ENTRYPOINT);
    let runMainCalls = 0;
    const check = (node: TSESTree.Expression) => {
      const resolved = resolveMember(node, imports);
      if (resolved === undefined) {
        return;
      }
      if (RUNNERS.has(resolved.member) && isMember(resolved, 'effect', 'Effect', resolved.member)) {
        context.report({ node, messageId: 'runner', data: { name: resolved.member } });
        return;
      }
      if (isMember(resolved, '@effect/platform-bun', 'BunRuntime', 'runMain')) {
        if (!isEntrypoint) {
          context.report({ node, messageId: 'runMainLocation' });
          return;
        }
        runMainCalls += 1;
        if (runMainCalls > 1) {
          context.report({ node, messageId: 'runMainCount' });
        }
      }
    };
    return {
      MemberExpression: check,
      Identifier: (node) => {
        if (isReferencePosition(node)) {
          check(node);
        }
      },
    };
  },
};

const SPAN_NAME = /^[A-Z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/u;

type FnMessage = 'spanName' | 'untraced';

const namedEffectFn: TSESLint.RuleModule<FnMessage> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      spanName: "Effect.fn must be named with a 'Service.method' string literal.",
      untraced: 'Application operations use named Effect.fn, not Effect.{{name}}.',
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
        if (
          isMember(resolved, 'effect', 'Effect', 'fnUntraced') ||
          isMember(resolved, 'effect', 'Effect', 'fnUntracedEager')
        ) {
          context.report({ node, messageId: 'untraced', data: { name: resolved.member } });
          return;
        }
        if (!isMember(resolved, 'effect', 'Effect', 'fn')) {
          return;
        }
        const [first] = node.arguments;
        if (
          first === undefined ||
          first.type !== 'Literal' ||
          typeof first.value !== 'string' ||
          !SPAN_NAME.test(first.value)
        ) {
          context.report({ node: first ?? node, messageId: 'spanName' });
        }
      },
    };
  },
};

const noModuleMutableState: TSESLint.RuleModule<'mutableBinding'> = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      mutableBinding:
        'Module-level mutable bindings are not allowed. Keep interface state in Atom through the application AtomRegistry.',
    },
  },
  defaultOptions: [],
  create: (context) => ({
    Program: (program) => {
      for (const statement of program.body) {
        const declaration =
          statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        if (
          declaration !== null &&
          declaration.type === 'VariableDeclaration' &&
          declaration.kind !== 'const'
        ) {
          context.report({ node: declaration, messageId: 'mutableBinding' });
        }
      }
    },
  }),
};

const plugin = {
  meta: { name: 'effect-style' },
  rules: {
    'context-service-contract': contextServiceContract,
    'schema-tagged-errors': schemaTaggedErrors,
    'no-error-erasure': noErrorErasure,
    'runtime-boundary': runtimeBoundary,
    'named-effect-fn': namedEffectFn,
    'no-module-mutable-state': noModuleMutableState,
  },
};

export default plugin;
