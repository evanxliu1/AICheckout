import type { RewardRuleV3 } from './types.ts';

/** Whether a catalog v3 rule has no condition at all: no spend cap, enroll-once or recurring
 * activation, time limit, payment-path condition, brand scope, choice or gate. A card's base is
 * its one unconditional `all-purchases` rule. Kept free of Zod so the engine does not load it. */
export function isUnconditionalRuleV3(rule: RewardRuleV3): boolean {
  return (
    rule.cap.kind !== 'spend' &&
    rule.activation !== 'enroll-once' &&
    rule.activation !== 'recurring' &&
    rule.limitedTime === null &&
    rule.excludedPaymentPaths.length === 0 &&
    rule.brandIds.length === 0 &&
    rule.excludedBrandIds.length === 0 &&
    rule.choice === null &&
    rule.requires.length === 0 &&
    rule.requiredPaymentPaths.length === 0
  );
}
