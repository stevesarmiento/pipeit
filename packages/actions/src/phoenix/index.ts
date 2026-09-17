/**
 * Phoenix perps action builders.
 *
 * Import directly via `@pipeit/actions/phoenix`.
 *
 * @packageDocumentation
 */

export { createPhoenixActionsClient, type PhoenixActionsClient, type PhoenixActionsClientConfig } from './client.js';

export { riseInstructionToKit, riseInstructionsToKit, type RiseInstructionLike } from './convert.js';

export {
    getPhoenixOpenPositionPlan,
    type PhoenixOpenPositionPlanOptions,
    type PhoenixOpenPositionPlanResult,
} from './plan-open-position.js';

export {
    getPhoenixClosePositionPlan,
    type PhoenixClosePositionPlanOptions,
    type PhoenixClosePositionPlanResult,
} from './plan-close-position.js';

export {
    getPhoenixCancelAllOrdersPlan,
    getPhoenixCancelOrdersByIdPlan,
    type PhoenixCancelAllOrdersPlanOptions,
    type PhoenixCancelOrdersByIdPlanOptions,
    type PhoenixCancelOrdersPlanResult,
} from './plan-cancel.js';

export {
    InvalidPhoenixInstructionError,
    InvalidPhoenixPositionSideError,
    InvalidPhoenixRiskConfigError,
    PhoenixClientRequiredError,
    PhoenixPlanError,
    UnknownPhoenixMarketError,
    UnsupportedPhoenixOrderConfigError,
} from './types.js';

export type * from './types.js';
