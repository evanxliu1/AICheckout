// Plain constants shared with the content script, which must stay free of zod and wallet code.
export const BADGE_PAGE = 'src/badge/index.html';
export const ONBOARDING_PAGE = 'src/onboarding/index.html';
export const POPUP_PAGE = 'src/popup/index.html';
/** postMessage envelope marker for iframe → content-script size and visibility messages. */
export const BADGE_MESSAGE_SOURCE = 'ai-checkout-badge';
