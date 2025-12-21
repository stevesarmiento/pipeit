import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
    // Keep native module external on server (loads real native bindings at runtime)
    serverExternalPackages: ['@pipeit/fastlane'],

    // Transpile these workspace packages
    transpilePackages: ['@pipeit/core', '@pipeit/actions'],

    /**
     * Monorepo + pnpm note:
     * - Vercel/Next server output uses file tracing to decide which files get shipped into the Lambda.
     * - `@pipeit/fastlane` is intentionally external (native addon), and it's also dynamically imported.
     * - With pnpm, the real package files often live under the repo root `node_modules/.pnpm/...`,
     *   which is outside the Next.js project directory (`examples/next-js`).
     *
     * Extend tracing to the monorepo root and force-include fastlane for the TPU route.
     */
    outputFileTracingRoot: path.join(__dirname, '../../'),
    outputFileTracingIncludes: {
        '/api/tpu': [
            // npm/yarn or fully hoisted installs
            'node_modules/@pipeit/fastlane/**',
            // pnpm store (actual package contents typically live here)
            '../../node_modules/.pnpm/**/node_modules/@pipeit/fastlane/**',
        ],
    },
};

export default nextConfig;
