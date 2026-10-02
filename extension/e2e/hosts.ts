import { MERCHANT_IDS, SITE_ADAPTERS } from '../src/checkout/adapters';

/** The automatic badge's host permissions: exactly the bundled adapters' hosts. */
export const BADGE_HOST_PERMISSIONS = [
  ...new Set(MERCHANT_IDS.flatMap((id) => SITE_ADAPTERS[id].match.hosts)),
]
  .sort()
  .map((host) => `https://${host}/*`);

/** What chrome.permissions.getAll() reports as origins: host permissions and content-script matches. */
export const BADGE_ORIGINS = [
  ...BADGE_HOST_PERMISSIONS,
  ...MERCHANT_IDS.flatMap((id) => SITE_ADAPTERS[id].matchPatterns),
].sort();
