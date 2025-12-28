# Contributing to Pipeit

Thank you for your interest in contributing to Pipeit! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork the repository**
2. **Clone your fork**

    ```bash
    git clone https://github.com/your-username/pipeit.git
    cd pipeit
    ```

3. **Install dependencies**

    ```bash
    pnpm install
    ```

4. **Create a branch**
    ```bash
    git checkout -b feature/your-feature-name
    ```

## 📦 Project Structure

This is a monorepo managed with Turbo and pnpm workspaces:

- `packages/core/` - Main transaction builder with execution strategies, Flow API, and Kit integration
- `packages/actions/` - InstructionPlan factories for DeFi (Titan, Metis)
- `packages/fastlane/` - Native Rust QUIC client for direct TPU submission (NAPI)
- `examples/next-js/` - Next.js example application demonstrating usage

## 🔧 Development Workflow

### Prerequisites

- Node.js >= 20.18.0
- pnpm >= 10
- Rust (for fastlane package development)

### Code Style

- Use TypeScript for all new code
- Follow the existing code style (Prettier + ESLint)
- Use functional programming patterns; avoid classes
- Prefer named exports for components
- Write meaningful commit messages following conventional commits

### TypeScript Guidelines

- Use strict TypeScript configuration
- Prefer interfaces over types
- Avoid enums; use maps instead
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- Follow the existing type patterns from `@solana/kit`

### Testing

- Add tests for new functionality
- Ensure all tests pass: `pnpm test`
- Maintain or improve code coverage
- Tests are located in `__tests__/` directories within each package

### Before Submitting

```bash
# Format code (if configured)
pnpm run format

# Lint code
pnpm lint

# Type check
pnpm typecheck

# Build all packages
pnpm build

# Run tests
pnpm test
```

## 📝 Pull Request Guidelines

1. **Clear Description**: Explain what changes you made and why
2. **Link Issues**: Reference any related issues
3. **Small PRs**: Keep changes focused and atomic
4. **Tests**: Include tests for new functionality
5. **Documentation**: Update README/docs if needed
6. **Breaking Changes**: Clearly mark breaking changes and update version numbers if needed

## 🎯 Package-Specific Guidelines

### @pipeit/core

- Follow Solana best practices for transaction building
- Ensure compatibility with `@solana/kit` patterns
- Add comprehensive error handling with proper error types
- Document new execution strategies or features
- Test on devnet before mainnet considerations

### @pipeit/actions

- Build Kit-compatible InstructionPlans
- Follow existing Titan/Metis patterns for new integrations
- Document quote/route/plan building pipeline
- Consider API rate limits and error handling

### @pipeit/fastlane

- Rust code follows standard Rust conventions
- Ensure NAPI bindings are properly typed
- Test QUIC connections on devnet
- Document platform-specific requirements
- Update `Cargo.toml` version when making changes

## 🐛 Bug Reports

Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, pnpm version)
- Relevant logs or error messages
- Package version (`@pipeit/core`, `@pipeit/actions`, etc.)
- Solana network (mainnet/devnet/testnet)

## 💡 Feature Requests

- Check existing issues first
- Provide clear use case and requirements
- Consider impact on all packages
- Think about backward compatibility
- Consider execution strategy implications (Jito, TPU, parallel)

## 🔍 Code Review Process

1. All PRs require at least one approval
2. CI must pass (lint, typecheck, build, test)
3. Code should follow project conventions
4. Documentation should be updated for user-facing changes

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions

- Open an issue for questions
- Check existing documentation in README.md and package READMEs
- Review `@solana/kit` documentation for Solana patterns
- Check examples in `examples/next-js/` for usage patterns

## 🛠️ Development Tips

### Running Individual Package Commands

```bash
# Build a specific package
cd packages/core
pnpm build

# Run tests for a specific package
cd packages/core
pnpm test

# Watch mode for development
cd packages/core
pnpm dev
```

### Testing Execution Strategies

When working on execution strategies (Jito, TPU, parallel), test with:

- Devnet for safe testing
- Multiple RPC endpoints
- Different network conditions
- Error scenarios (network failures, timeouts)

### Working with Fastlane (Rust)

```bash
cd packages/fastlane

# Build native bindings
pnpm build:native

# Run tests
pnpm test

# Check Rust code
cargo check
cargo clippy
```
