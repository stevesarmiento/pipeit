import type { NextConfig } from 'next';
import path from 'node:path';

const isVercelBuild = process.env.VERCEL === '1';

const nextConfig: NextConfig = {
    // Keep native module external on server (loads real native bindings at runtime)
    serverExternalPackages: ['@pipeit/fastlane'],

    // Transpile these workspace packages
    transpilePackages: ['@pipeit/core', '@pipeit/actions'],

    /**
     * Monorepo + Bun workspace note:
     * - Vercel/Next server output uses file tracing to decide which files get shipped into the Lambda.
     * - `@pipeit/fastlane` is intentionally external (native addon), and it's also dynamically imported.
     * - With workspace installs, `node_modules/@pipeit/fastlane` can be a symlink to
     *   `packages/fastlane`, outside the Next.js project directory (`examples/next-js`).
     *
     * Extend tracing to the monorepo root and force-include fastlane for the TPU route.
     */
    ...(isVercelBuild
        ? {
              outputFileTracingRoot: path.join(__dirname, '../../'),
              outputFileTracingIncludes: {
                  '/api/tpu': [
                      // App-local install, if present
                      'node_modules/@pipeit/fastlane/**',
                      // Hoisted workspace install, if used
                      '../../node_modules/@pipeit/fastlane/**',
                      // Bun workspace package source
                      '../../packages/fastlane/**',
                  ],
              },
          }
        : {}),
};

export default nextConfig;
