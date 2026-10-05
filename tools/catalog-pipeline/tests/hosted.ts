// An in-memory stand-in for the hosted review API and Supabase Auth, for the login and publish tests. Nothing here
// contacts a network: the CLI gets this `fetch`. Every token it issues contains SECRET, so a test can assert that no
// token (or the password, also SECRET-based) ever reaches stdout.
import { randomUUID } from 'node:crypto';
import { jsonSha256, sha256Hex } from '../src/hash.ts';

export const SECRET = 'SENTINEL-SECRET-7f3a';
export const PASSWORD = `${SECRET}-password`;
export const EMAIL = 'evan@example.test';
export const API = 'https://api.example.test';
export const SUPABASE = 'https://project.supabase.example.test';
export const PUBLISHABLE_KEY = 'sb_publishable_test_key';
export const REVIEWER_ID = '11111111-2222-4333-8444-555555555555';

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

interface Doc {
  id: string;
  source_key: string;
  title: string;
  url: string;
  checked_on: string;
  body: string;
  content_hash: string;
  created_by: string;
  created_at: string;
}
interface Draft {
  id: string;
  catalog: unknown;
  catalog_hash: string;
  source_document_ids: string[];
  base_sequence: number | null;
  revision: number;
  status: 'draft' | 'published' | 'rejected';
  created_by: string;
  created_at: string;
  updated_at: string;
}
interface Release {
  sequence: number;
  catalog: { version: string };
  version: string;
  catalog_hash: string;
  published_at: string;
}

export interface Hosted {
  fetch: typeof fetch;
  calls: Call[];
  /** The refresh token Supabase accepts now (rotated on every refresh). */
  refreshToken: string;
  accessTokens: Set<string>;
  refreshes: number;
  reviewer: boolean;
  head: number | null;
  release: Release | null;
  drafts: Map<string, Draft>;
  docs: Map<string, Doc>;
  /** Answer the next /v1/review/sources requests with 429 (Retry-After seconds). */
  rateLimits: number[];
  /** Expire every access token after this many more review requests. */
  expireAccessAfter: number | null;
  logoutFails: boolean;
  publishedAt: string;
  addDraft: (catalog: unknown, base: number | null, sourceIds?: string[]) => Draft;
  addDoc: (source: { id: string; title: string; url: string; checkedOn: string }, body: string) => Doc;
  setRelease: (catalog: { version: string }) => void;
}

const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export function hosted(): Hosted {
  let issued = 0;
  const stamp = '2026-10-04T11:00:00.000Z';
  const state: Hosted = {
    fetch: undefined as unknown as typeof fetch,
    calls: [],
    refreshToken: `${SECRET}-refresh-0`,
    accessTokens: new Set(),
    refreshes: 0,
    reviewer: true,
    head: null,
    release: null,
    drafts: new Map(),
    docs: new Map(),
    rateLimits: [],
    expireAccessAfter: null,
    logoutFails: false,
    publishedAt: '2026-10-04T12:00:00.000Z',
    addDraft: (catalog, base, sourceIds = []) => {
      const draft: Draft = {
        id: randomUUID(),
        catalog,
        catalog_hash: jsonSha256(catalog),
        source_document_ids: sourceIds,
        base_sequence: base,
        revision: 1,
        status: 'draft',
        created_by: REVIEWER_ID,
        created_at: stamp,
        updated_at: stamp,
      };
      state.drafts.set(draft.id, draft);
      return draft;
    },
    addDoc: (source, body) => {
      const content_hash = sha256Hex(new TextEncoder().encode(body));
      for (const doc of state.docs.values())
        if (
          doc.source_key === source.id &&
          doc.checked_on === source.checkedOn &&
          doc.content_hash === content_hash
        )
          return doc;
      const doc: Doc = {
        id: randomUUID(),
        source_key: source.id,
        title: source.title,
        url: source.url,
        checked_on: source.checkedOn,
        body,
        content_hash,
        created_by: REVIEWER_ID,
        created_at: stamp,
      };
      state.docs.set(doc.id, doc);
      return doc;
    },
    setRelease: (catalog) => {
      state.head = (state.head ?? 0) + 1;
      state.release = {
        sequence: state.head,
        catalog,
        version: catalog.version,
        catalog_hash: jsonSha256(catalog),
        published_at: state.publishedAt,
      };
    },
  };
  const issue = () => {
    issued++;
    const access = `${SECRET}-access-${issued}`;
    state.accessTokens.add(access);
    state.refreshToken = `${SECRET}-refresh-${issued}`;
    return {
      access_token: access,
      refresh_token: state.refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: REVIEWER_ID, email: EMAIL },
    };
  };
  const summary = (draft: Draft) => ({
    reviewerId: REVIEWER_ID,
    head: state.head,
    published: state.release,
    draft,
    sources: draft.source_document_ids.map((id) => {
      const { body, ...rest } = state.docs.get(id)!;
      return { ...rest, body_chars: body.length };
    }),
  });

  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, url: url.href, body });
    const headers = new Headers(init?.headers);
    if (url.origin === SUPABASE) {
      if (headers.get('apikey') !== PUBLISHABLE_KEY) return json(401, { error: 'no_api_key' });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password')
        return body.email === EMAIL && body.password === PASSWORD
          ? json(200, issue())
          : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        if (body.refresh_token !== state.refreshToken)
          return json(400, { error_code: 'refresh_token_not_found' });
        state.refreshes++;
        return json(200, issue());
      }
      if (url.pathname === '/auth/v1/logout') {
        if (state.logoutFails) throw new TypeError('fetch failed');
        state.accessTokens.clear();
        state.refreshToken = 'revoked';
        return new Response(null, { status: 204 });
      }
      return json(404, { error: 'not_found' });
    }
    if (url.origin !== API) throw new TypeError(`unexpected host ${url.origin}`);
    if (url.pathname === '/review/config.json')
      return json(200, { supabaseUrl: SUPABASE, publishableKey: PUBLISHABLE_KEY });
    if (url.pathname === '/v1/catalog') return json(200, { release: state.release });
    if (!url.pathname.startsWith('/v1/review/')) return json(404, { error: 'not_found' });
    const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (state.expireAccessAfter !== null && state.expireAccessAfter-- <= 0) {
      state.accessTokens.clear();
      state.expireAccessAfter = null;
    }
    if (!state.accessTokens.has(token)) return json(401, { error: 'sign_in_required' });
    if (!state.reviewer) return json(403, { error: 'reviewer_access_required' });
    const path = url.pathname.slice('/v1/review'.length);
    const draftMatch = /^\/drafts\/([^/]+)(\/publish)?$/.exec(path);
    if (method === 'GET' && path === '/')
      return json(200, {
        reviewerId: REVIEWER_ID,
        head: state.head,
        drafts: [...state.drafts.values()].map((draft) => ({
          id: draft.id,
          revision: draft.revision,
          status: draft.status,
          updated_at: draft.updated_at,
          base_sequence: draft.base_sequence,
          version: (draft.catalog as { version: string }).version,
        })),
      });
    if (method === 'POST' && path === '/drafts')
      return json(200, state.addDraft(body.catalog, body.baseSequence, body.sourceDocumentIds));
    if (method === 'POST' && path === '/sources') {
      const wait = state.rateLimits.shift();
      if (wait !== undefined)
        return json(429, { error: 'too_many_requests' }, { 'retry-after': String(wait) });
      return json(
        200,
        state.addDoc(
          { id: body.sourceKey, title: body.title, url: body.url, checkedOn: body.checkedOn },
          body.body,
        ),
      );
    }
    if (draftMatch) {
      const draft = state.drafts.get(draftMatch[1]);
      if (!draft) return json(404, { error: 'draft_not_found' });
      if (method === 'GET' && !draftMatch[2]) return json(200, summary(draft));
      if (method === 'PUT' && !draftMatch[2]) {
        if (body.expectedRevision !== draft.revision) return json(409, { error: 'review_changed' });
        Object.assign(draft, {
          catalog: body.catalog,
          catalog_hash: jsonSha256(body.catalog),
          source_document_ids: body.sourceDocumentIds,
          base_sequence: body.baseSequence,
          revision: draft.revision + 1,
          updated_at: '2026-10-04T11:30:00.000Z',
        });
        return json(200, draft);
      }
      if (method === 'POST' && draftMatch[2]) {
        if (
          body.expectedRevision !== draft.revision ||
          body.expectedHash !== draft.catalog_hash ||
          body.expectedHead !== state.head
        )
          return json(409, { error: 'review_changed' });
        draft.status = 'published';
        state.setRelease(draft.catalog as { version: string });
        return json(200, state.release);
      }
    }
    return json(404, { error: 'not_found' });
  }) as typeof fetch;
  return state;
}
