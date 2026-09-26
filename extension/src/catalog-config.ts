import { createCatalogFetcher } from '@ai-checkout/catalog-client';

const endpoint = import.meta.env.VITE_CATALOG_API_URL;
export const fetchPublishedCatalog = endpoint ? createCatalogFetcher(endpoint) : undefined;
