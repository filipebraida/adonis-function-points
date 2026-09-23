import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './index.ts',
    './configure.ts',
    './src/types.ts',
    './src/inventory/resolvers/index.ts',
    './providers/function_points_provider.ts',
    './commands/main.ts',
  ],
  outDir: './build',
  clean: true,
  format: 'esm',
  dts: false,
  target: 'esnext',
})
