import * as rewardsCore from '@ai-checkout/rewards-core';
import { catalogSchema, type Catalog } from '@ai-checkout/rewards-core';

/**
 * Catalogs bundled with `@ai-checkout/rewards-core` that a reviewer can start a draft from, newest
 * schema first. `CATALOG_V3` (the 180-card catalog, Stage 2 M5) is offered as soon as the package
 * exports it; until then only `CATALOG_V2` is. An export that fails the catalog schema is left out.
 */
export const BUNDLED_CATALOG_EXPORTS = ['CATALOG_V3', 'CATALOG_V2'] as const;

export function bundledCatalogs(exports: Record<string, unknown> = { ...rewardsCore }): Catalog[] {
  return BUNDLED_CATALOG_EXPORTS.flatMap((name) => {
    const parsed = exports[name] === undefined ? undefined : catalogSchema.safeParse(exports[name]);
    return parsed?.success ? [parsed.data] : [];
  });
}
