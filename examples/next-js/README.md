# Pipeit Next.js Example

Interactive example application showcasing Pipeit's transaction building capabilities with live mainnet demos.

## Quick Start

```bash
# From repo root
pnpm install

# Run the example
cd examples/next-js
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the landing page and playground.

## Pages

### Landing Page (`/`)

Demonstrates the value proposition of Pipeit with:

- Hero section with key messaging
- Benefits overview
- Side-by-side code comparison (@solana/kit vs @pipeit/core)
- Feature highlights (bento grid)
- Playground CTA

### Playground (`/playground`)

Interactive demos of various pipeline patterns with real mainnet transactions:

| Example | Description |
|---------|-------------|
| **Simple Transfer** | Single instruction, single transaction - baseline example |
| **Batched Transfers** | Multiple transfers batched into one atomic transaction |
| **Mixed Pipeline** | Instruction and transaction steps - shows when batching breaks |
| **Jupiter Swap** | Token swap using Jupiter aggregator |
| **Pipe Multi-Swap** | SOL → USDC → BONK sequential swaps with Flow orchestration |
| **Jito Bundle** | MEV-protected bundle submission with Jito tip instructions |
| **TPU Direct** | Direct QUIC submission to validator TPU - bypass RPC for max speed |

Each example includes:

- Visual pipeline execution flow
- Strategy switcher (auto/batch/sequential)
- Code view with syntax highlighting
- Real wallet connection and execution

## Project Structure

```
examples/next-js/
├── app/
│   ├── page.tsx              # Landing page
│   ├── playground/
│   │   └── page.tsx          # Interactive pipeline playground
│   ├── api/
│   │   ├── tpu/              # TPU submission endpoint
│   │   └── jupiter/          # Jupiter API proxy
│   └── providers.tsx         # App providers
├── components/
│   ├── landing/              # Landing page components
│   ├── pipeline/             # Pipeline visualization
│   ├── connector/            # Wallet connection UI
│   └── ui/                   # shadcn/ui components
└── lib/
    ├── use-tpu-submission.ts # TPU submission hook
    └── visual-pipeline.ts    # Pipeline visualization logic
```

## Key Features Demonstrated

### Execution Strategies

The playground shows all four execution presets in action:

- `'standard'` - Default RPC submission
- `'economical'` - Jito bundle only
- `'fast'` - Jito + parallel RPC race
- `'ultra'` - TPU direct (via @pipeit/fastlane)

### TPU Direct Submission

The TPU Direct example shows:

- Real-time per-leader send results
- Latency measurements
- Connection status to validator TPU endpoints
- Server-side QUIC handling via `/api/tpu` route

### Flow API

Multi-step examples demonstrate:

- Dynamic context between steps
- Automatic batching strategies
- Atomic instruction groups
- Lifecycle hooks

## Dependencies

- `@pipeit/core` - Transaction builder
- `@pipeit/actions` - DeFi actions (Jupiter swaps)
- `@pipeit/fastlane` - TPU direct submission
- `@solana/kit` - Solana primitives
- `@solana/connector` - Wallet connection
- `next` - React framework
- `shadcn/ui` - UI components
- `motion` - Animations

## Environment Variables

Create `.env.local` for custom RPC:

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
```

## Commands

```bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm lint       # Run linter
pnpm benchmark  # Run strategy benchmarks
```

## Learn More

- [Pipeit Documentation](../../README.md)
- [@pipeit/core README](../../packages/core/README.md)
- [@pipeit/actions README](../../packages/actions/README.md)
