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
    '@solana/addresses',
    '@solana/codecs-strings',
    '@solana/errors',
    '@solana/functional',
    '@solana/instructions',
    '@solana/programs',
    '@solana/rpc',
    '@solana/rpc-subscriptions',
    '@solana/rpc-types',
    '@solana/signers',
    '@solana/transaction-messages',
    '@solana/transactions',
  ],
}));

