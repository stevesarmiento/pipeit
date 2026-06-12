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
     * Extend tracing to the monorepo root and force-include only fastlane runtime files
     * for the TPU route. Do not include the whole workspace package: that pulls in
     * Cargo build output and package-manager symlinks that Vercel cannot package as a
     * Serverless Function.
     */
    ...(isVercelBuild
        ? {
              outputFileTracingRoot: path.join(__dirname, '../../'),
              outputFileTracingIncludes: {
                  '/api/tpu': [
                      '../../node_modules/@pipeit/fastlane/package.json',
                      '../../node_modules/@pipeit/fastlane/index.js',
                      '../../node_modules/@pipeit/fastlane/*.node',
                      '../../packages/fastlane/package.json',
                      '../../packages/fastlane/index.js',
                      '../../packages/fastlane/*.node',
                  ],
              },
              outputFileTracingExcludes: {
                  '/api/tpu': [
                      '../../node_modules/@pipeit/fastlane/node_modules/**',
                      '../../node_modules/@pipeit/fastlane/target/**',
                      '../../node_modules/@pipeit/fastlane/src/**',
                      '../../node_modules/@pipeit/fastlane/vendor/**',
                      '../../packages/fastlane/node_modules/**',
                      '../../packages/fastlane/target/**',
                      '../../packages/fastlane/src/**',
                      '../../packages/fastlane/vendor/**',
                  ],
              },
          }
        : {}),
};

export default nextConfig;
