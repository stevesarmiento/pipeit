import { defineConfig } from 'tsup';

export default defineConfig(options => ({
    entry: {
        index: 'src/index.ts',
        'titan/index': 'src/titan/index.ts',
        'metis/index': 'src/metis/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: {
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
        '@solana/instruction-plans',
        '@solana/instructions',
        '@solana/rpc',
        '@solana/rpc-subscriptions',
        '@solana/signers',
        '@solana/transactions',
    ],
}));
