import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: options.watch ? false : {
    resolve: true,
  },
  tsconfig: './tsconfig.json',
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    '@solana/kit',
    '@solana/codecs',
    '@solana/addresses',
    '@solana/instructions',
    '@solana/rpc',
    '@solana/rpc-types',
    '@pipeit/tx-builder',
  ],
}));

