/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Browser-test builds only (YYYY-MM-DD): re-dates the bundled catalog. */
  readonly VITE_E2E_CATALOG_DATE?: string;
  /** Hosted builds: the fixed `/v1/catalog` endpoint; its origin also serves `/v1/merchants` and `/v1/events`. */
  readonly VITE_CATALOG_API_URL?: string;
  /** Phase 15.3: `1` turns the consented usage reporting on (consent screen, queue, `/v1/events`). Needs
   * `VITE_CATALOG_API_URL`. Without it the build has no consent screen and sends nothing. */
  readonly VITE_TELEMETRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
