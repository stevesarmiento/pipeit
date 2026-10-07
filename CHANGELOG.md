# Changelog

All notable changes to the pipeit packages are documented here. Versions
follow [Semantic Versioning](https://semver.org/).

## @pipeit/core 0.5.0

Priority-fee controls for wallet builders. Everything is additive: existing
configs, the `'medium'` default, the explicit-config-wins rule, Flow's
`400_000` atomic-group limit and the legacy/v0 prefix order are unchanged.

### Added

- `priorityFee: { strategy: 'custom', resolve }`: an async resolver that
  receives a `PriorityFeeContext` (version, fee payer, normalized
  instructions, writable accounts, the known compute unit limit and a lazy
  `draftTransactionBase64()`) and returns micro-lamports per CU. Runs after
  the limit is resolved on v1. Resolver errors propagate.
- `priorityFee.preferInstruction` and `computeUnits.preferInstruction`: use a
  caller-supplied `SetComputeUnitPrice` / `SetComputeUnitLimit` when present,
  otherwise the configured strategy.
- `priorityFee.maxLamports`: a hard cap on the total priority fee, applied
  after the final compute unit limit is known. Clamps the v1 total, or reduces
  the legacy/v0 per-CU price (against the runtime's worst-case limit when no
  limit instruction is emitted). Clamping to zero emits no price instruction.
  Clamps are logged unless `logLevel` is `'silent'`.
- `TransactionBuilder.buildWithBudget()`: returns `{ message, budget }` where
  `budget: ResolvedBudget` reports the compute unit limit, per-CU price,
  total priority fee in lamports, data size limit, heap size and the source of
  the price and limit. `build()` is unchanged.
- `PriorityFeeConfig.microLamports` also accepts `bigint`.
- Exported helpers `worstCaseComputeUnitLimit`, `clampMicroLamportsToTotal`
  and `collectWritableAccounts`, and types `PriorityFeeContext`,
  `PriorityFeeResolver`, `ResolvedBudget`, `ResolvedBudgetSource`,
  `BuildWithBudgetResult`.

### Changed

- `estimatePriorityFee` throws for `strategy: 'custom'`, which only the
  builder can resolve.
- The constructor throws when `strategy: 'custom'` has no `resolve` function
  or when `maxLamports` is negative.

## @pipeit/actions 0.4.2

- Peer dependency on `@pipeit/core` widened to `^0.3.1 || ^0.4.0 || ^0.5.0`.
- Titan round-trip tests cover the wallet fee policy (`'custom'` +
  `preferInstruction` + `maxLamports`) on v0 and v1.
