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

export { createFlashApiPriceSource, flashApiPriceToOraclePrice, FLASH_DEFAULT_API_BASE_URL } from './price-source.js';

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

export type * from './types.js';
