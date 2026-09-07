// @ts-check
const importPlugin = require('eslint-plugin-import');

/**
 * Enforces that api/src/modules/<a> can only import api/src/modules/<b> through
 * its public barrel (index.ts), never by reaching into another module's internals.
 * Keeps "each module owns its business rules/service/API/DB access" true as the
 * module count grows toward the full product map.
 */
function createModuleBoundaries() {
  return {
    files: ['src/modules/**/*.ts'],
    plugins: { import: importPlugin },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/modules/*/!(index.ts)',
              from: './src/modules/*',
              except: ['./index.ts'],
              message:
                'Cross-module imports must go through the target module\'s index.ts barrel, not its internal files.',
            },
          ],
        },
      ],
    },
  };
}

module.exports = { createModuleBoundaries };
