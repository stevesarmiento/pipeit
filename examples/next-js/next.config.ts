import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Keep native module external on server (loads real native bindings at runtime)
    serverExternalPackages: ['@pipeit/fastlane'],
    
    // Transpile these workspace packages  
    transpilePackages: ['@pipeit/core', '@pipeit/actions'],
};

export default nextConfig;
