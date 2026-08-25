import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

type ImportBinding = {
  readonly source: string;
  readonly imported: string;
};

export type ImportMap = ReadonlyMap<string, ImportBinding>;

export type ResolvedMember = {
  readonly module: string;
  readonly namespace: string;
  readonly member: string;
};

export type FunctionNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression;

export const collectImports = (program: TSESTree.Program): ImportMap => {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      const source = statement.source.value;
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value;
          bindings.set(specifier.local.name, { source, imported });
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          bindings.set(specifier.local.name, { source, imported: 'default' });
        } else {
          bindings.set(specifier.local.name, { source, imported: '*' });
        }
      }
    }
  }
  return bindings;
};

const unwrapExpression = (node: TSESTree.Expression): TSESTree.Expression => {
  let current: TSESTree.Expression = node;
  while (
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSInstantiationExpression' ||
    current.type === 'ChainExpression'
  ) {
    current = current.expression;
  }
  return current;
};

export const resolveMember = (
  node: TSESTree.Expression,
  imports: ImportMap,
): ResolvedMember | undefined => {
  const target = unwrapExpression(node);
  if (
    target.type === 'MemberExpression' &&
    !target.computed &&
    target.object.type === 'Identifier' &&
    target.property.type === 'Identifier'
  ) {
    const binding = imports.get(target.object.name);
    if (binding === undefined) {
      return undefined;
    }
    return { module: binding.source, namespace: binding.imported, member: target.property.name };
  }
  if (target.type === 'Identifier') {
    const binding = imports.get(target.name);
    if (binding === undefined) {
      return undefined;
    }
    return { module: binding.source, namespace: '', member: binding.imported };
  }
  return undefined;
};

export const isMember = (
  resolved: ResolvedMember,
  module: string,
  namespace: string,
  member: string,
): boolean => {
  if (resolved.member !== member) {
    return false;
  }
  if (resolved.module === module) {
    return resolved.namespace === namespace;
  }
  return (
    resolved.module === `${module}/${namespace}` &&
    (resolved.namespace === '*' || resolved.namespace === '')
  );
};

export const heritageBase = (expression: TSESTree.Expression): TSESTree.Expression => {
  let current: TSESTree.Expression = expression;
  while (current.type === 'CallExpression') {
    current = current.callee;
  }
  return current;
};

export const isFunctionNode = (node: TSESTree.Node): node is FunctionNode =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

export const isGlobalReference = (
  node: TSESTree.Expression,
  name: string,
  imports: ImportMap,
): boolean => node.type === 'Identifier' && node.name === name && !imports.has(name);

const isNode = (value: unknown): value is TSESTree.Node =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';

export const someDescendant = (
  root: TSESTree.Node,
  predicate: (node: TSESTree.Node) => boolean,
): boolean => {
  const pending: TSESTree.Node[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      return false;
    }
    if (predicate(current)) {
      return true;
    }
    for (const key of Object.keys(current)) {
      if (key !== 'parent') {
        const value: unknown = Reflect.get(current, key);
        if (Array.isArray(value)) {
          for (const item of value) {
            if (isNode(item)) {
              pending.push(item);
            }
          }
        } else if (isNode(value)) {
          pending.push(value);
        }
      }
    }
  }
  return false;
};

export const hasAncestor = (
  node: TSESTree.Node,
  ancestors: ReadonlySet<TSESTree.Node>,
): boolean => {
  let current: TSESTree.Node | undefined = node;
  while (current !== undefined) {
    if (ancestors.has(current)) {
      return true;
    }
    const parent: unknown = current.parent;
    current = isNode(parent) ? parent : undefined;
  }
  return false;
};

const normalizedFilename = (context: TSESLint.RuleContext<string, readonly unknown[]>): string =>
  context.physicalFilename.replaceAll('\\', '/');

export const fileEndsWith = (
  context: TSESLint.RuleContext<string, readonly unknown[]>,
  suffix: string,
): boolean => normalizedFilename(context).endsWith(suffix);

export const isReferencePosition = (node: TSESTree.Identifier): boolean => {
  const { parent } = node;
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') {
    return false;
  }
  if (parent.type === 'ImportNamespaceSpecifier' || parent.type === 'ExportSpecifier') {
    return false;
  }
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'Property' && parent.key === node && !parent.computed) {
    return false;
  }
  return true;
};
