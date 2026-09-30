/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Browser-test builds only (YYYY-MM-DD): re-dates the bundled catalog. */
  readonly VITE_E2E_CATALOG_DATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
