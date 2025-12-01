import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: {
    index: 'src/index.ts',
    'adapters/index': 'src/adapters/index.ts',
    'adapters/jupiter': 'src/adapters/jupiter.ts',
  },
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
    '@pipeit/core',
    '@solana/kit',
    '@solana/addresses',
    '@solana/instructions',
    '@solana/rpc',
    '@solana/rpc-subscriptions',
    '@solana/signers',
    '@solana/transactions',
  ],
}));
