/** The automatic badge's host permissions (Phase 13c): every https site, so the badge can recognise
 * a cart at any store. The legacy adapters' hosts are a subset. */
export const BADGE_HOST_PERMISSIONS = ['https://*/*'];

/** What chrome.permissions.getAll() reports as origins: host permissions and content-script matches
 * (the same pattern, reported once). */
export const BADGE_ORIGINS = [...BADGE_HOST_PERMISSIONS];
