import type { Rule } from 'eslint';

const isInsideString = (line: string, matchIndex: number) => {
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < matchIndex; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false;
    }
  }
  return inString;
};

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow double type assertions without explicit approval',
    },
    messages: {
      doubleAssertion:
        'Double type assertion bypasses type safety. Add oxlint-disable with explanation if intentional.',
    },
  },
  create(context) {
    const castPattern = /as\s+unknown\s+as\b/g;

    return {
      Program() {
        const lines = context.sourceCode.getText().split('\n');
        for (const [index, line] of lines.entries()) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          castPattern.lastIndex = 0;
          const match = castPattern.exec(line);
          if (match && !isInsideString(line, match.index)) {
            context.report({
              messageId: 'doubleAssertion',
              loc: {
                start: { line: index + 1, column: match.index },
                end: { line: index + 1, column: match.index + match[0].length },
              },
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'unknown-cast',
  },
  rules: {
    forbidden: rule,
  },
};

export default plugin;
