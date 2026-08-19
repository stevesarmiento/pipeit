/**
 * Flash Trade perps action builders.
 *
 * Import directly via `@pipeit/actions/flash`.
 *
 * @packageDocumentation
 */

export { createFlashActionsClient } from './client.js';

export {
    web3InstructionToKit,
    web3InstructionsToKit,
    web3LookupTableAddressesToKit,
    type Web3InstructionLike,
} from './convert.js';

export {
    createFlashPythPriceSource,
    pythPriceToOraclePrice,
    FLASH_PYTH_HERMES_BASE_URL,
    type FlashPythPriceSourceConfig,
    type PythParsedPrice,
} from './price-source.js';

export {
    getFlashOpenPositionPlan,
    type FlashOpenPositionPlanOptions,
    type FlashOpenPositionPlanResult,
} from './plan-open-position.js';

export {
    getFlashClosePositionPlan,
    type FlashClosePositionPlanOptions,
    type FlashClosePositionPlanResult,
} from './plan-close-position.js';

export {
    getFlashCancelTriggerOrderPlan,
    getFlashCancelAllTriggerOrdersPlan,
    type FlashCancelTriggerOrderPlanOptions,
    type FlashCancelAllTriggerOrdersPlanOptions,
    type FlashCancelTriggerOrdersPlanResult,
} from './plan-cancel.js';

export {
    FlashClientRequiredError,
    FlashMarketConfigError,
    FlashPlanError,
    FlashPriceSourceError,
    FlashTraderMismatchError,
    InvalidFlashAmountError,
    InvalidFlashInstructionError,
    InvalidFlashPositionSideError,
    InvalidFlashRiskConfigError,
    UnsupportedFlashAdditionalSignersError,
    UnsupportedFlashCollateralError,
    UnsupportedFlashOrderConfigError,
} from './types.js';

export type * from './types.js';
