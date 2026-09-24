import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './index.ts',
    './configure.ts',
    './src/types.ts',
    './src/pipeline.ts',
    './src/inventory/resolvers/index.ts',
    './commands/main.ts',
    './src/cli.ts',
  ],
  outDir: './build',
  clean: true,
  format: 'esm',
  dts: false,
  target: 'esnext',
  /**
   * `.js`, not `.mjs`. The package is `"type": "module"`, so `.js` is already
   * ESM, and every path in `package.json` exports points at `.js`.
   */
  outExtensions: () => ({ js: '.js' }),
})
