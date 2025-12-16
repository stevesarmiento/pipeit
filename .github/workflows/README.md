# GitHub Actions Workflows

## build-fastlane.yml

Builds the `@pipeit/fastlane` package for multiple platforms using NAPI-RS.

### Supported Platforms

- **Linux x64 (GNU)**: `x86_64-unknown-linux-gnu`
- **Linux x64 (musl)**: `x86_64-unknown-linux-musl`
- **Linux ARM64 (GNU)**: `aarch64-unknown-linux-gnu`
- **Linux ARM64 (musl)**: `aarch64-unknown-linux-musl`
- **macOS x64**: `x86_64-apple-darwin`
- **macOS ARM64**: `aarch64-apple-darwin`
- **macOS Universal**: Universal binary combining x64 and ARM64
- **Windows x64**: `x86_64-pc-windows-msvc`

### Workflow Stages

1. **Build**: Compiles native binaries for each platform
    - Uses Docker for Linux cross-compilation
    - Native runners for macOS and Windows
    - Uploads artifacts for each platform

2. **Test**: Tests bindings on actual hardware
    - Tests on macOS (ARM64), Linux (x64), and Windows (x64)
    - Runs on Node.js 18, 20, and 22
    - Verifies the native module loads correctly

3. **Universal macOS**: Creates universal macOS binary
    - Combines x64 and ARM64 binaries
    - Single binary works on both architectures

4. **Publish**: Publishes to npm (only on main branch)
    - Automatic publishing when commit message is a version number (e.g., `1.0.0`)
    - Publishes main package and platform-specific packages
    - Uses npm provenance for supply chain security

### Triggers

- **Push to main**: Runs full workflow including publish
- **Pull requests**: Runs build and test only
- **Manual dispatch**: Can be triggered manually from GitHub Actions UI
- **Path filters**: Only runs when `packages/fastlane/**` changes

### Environment Variables

- `MACOSX_DEPLOYMENT_TARGET`: Set to `10.13` for maximum compatibility
- `DEBUG`: Enables NAPI-RS debug logging

### Prerequisites for Publishing

1. Set `NPM_TOKEN` secret in GitHub repository settings
2. Commit message must match version pattern (e.g., `1.0.0`) for auto-publish
3. All tests must pass

### Manual Build

To build locally:

```bash
cd packages/fastlane
pnpm install
pnpm build
```

To test locally:

```bash
pnpm test
```

### Troubleshooting

- **Build fails on Linux**: Ensure Docker images are up to date
- **Tests fail on specific platform**: Check artifact upload/download steps
- **Publish fails**: Verify NPM_TOKEN is set and has publish permissions
