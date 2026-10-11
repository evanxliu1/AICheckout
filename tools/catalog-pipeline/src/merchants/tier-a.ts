// Tier A (plan section 6): deterministic records for the long tail, no model. The homepage is rendered once (Playwright,
// logged out); its og:site_name, application-name or <title> gives the display name, falling back to the domain's own
// label capitalised. Everything else is the default: merchant, physical goods (the frame's classification),
// general-merchandise with default evidence, no brands. The homepage text is a gitignored capture; its hash goes to
// evals/merchants/db/tier-a-manifest.json.
//   pipeline merchants tier-a [--only a.com,b.com] [--limit N]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { merchantRecordSchema } from '../../../../packages/rewards-core/src/merchant-release.ts';
import type { MerchantRecord } from '../../../../packages/rewards-core/src/types.ts';
import { sha256Hex } from '../hash.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { domainLabel, hostGate, loadCandidates } from './candidates.ts';
import { DB_DIR, RECORDS_DIR, TIER_A_MANIFEST } from './files.ts';

export interface HomepageMeta {
  ogSiteName: string | null;
  applicationName: string | null;
  title: string | null;
}

const NAME = merchantRecordSchema.shape.name;
/** The capture script's bot-wall pattern (scripts/capture-issuer-pages.mjs). */
const BOT_WALL =
  /access denied|captcha|unusual (traffic|activity)|are you a robot|request (was )?blocked|verify you are human|enable javascript to/i;

/** The record name from the homepage's own metadata, or the domain's label capitalised. Names are cut at the first
 * separator ("Kroger | Shop Groceries" → "Kroger"), restricted to the record charset and 60 characters. */
export function displayName(meta: HomepageMeta, domain: string): { name: string; source: string } {
  const clean = (value: string | null): string | null => {
    if (!value) return null;
    const first = value.split(/\s+[|–—:·•-]\s+|\s[|•·]\s|\s+-\s+/)[0] ?? value;
    const kept = first
      .replace(/[^A-Za-z0-9 &'.,+-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
      .trim();
    return NAME.safeParse(kept).success ? kept : null;
  };
  const candidates: [string, string | null][] = [
    ['og:site_name', clean(meta.ogSiteName)],
    ['application-name', clean(meta.applicationName)],
    ['title', clean(meta.title)],
  ];
  for (const [source, name] of candidates) if (name) return { name, source };
  const label = domainLabel(domain);
  return { name: label.charAt(0).toUpperCase() + label.slice(1), source: 'domain-label' };
}

export function tierARecord(domain: string, name: string, id = `${domainLabel(domain)}-us`): MerchantRecord {
  return merchantRecordSchema.parse({
    id,
    name,
    hosts: [domain],
    kind: 'merchant',
    physicalGoods: true,
    category: 'general-merchandise',
    evidence: { basis: 'default', sourceIds: [] },
    brandIds: [],
    disabled: false,
  });
}

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stores: z.record(
    z.string(),
    z.strictObject({
      url: z.url(),
      capturedOn: z.iso.date(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      length: z.int().nonnegative(),
      nameSource: z.string(),
      status: z.int(),
      robots: z.enum(['allowed', 'disallowed', 'unknown']),
    }),
  ),
});

/** Renders the homepage logged out and reads its name metadata and text. */
export async function captureHomepage(domain: string): Promise<{
  meta: HomepageMeta;
  text: string;
  status: number;
  robots: 'allowed' | 'disallowed' | 'unknown';
}> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1600 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const url = `https://${domain}/`;
    let robots: 'allowed' | 'disallowed' | 'unknown' = 'unknown';
    try {
      const response = await context.request.get(`https://${domain}/robots.txt`, { timeout: 15_000 });
      if (response.ok()) {
        const text = await response.text();
        const star = text.split(/user-agent:\s*\*/i)[1]?.split(/user-agent:/i)[0] ?? '';
        robots = /^\s*disallow:\s*\/\s*$/im.test(star) ? 'disallowed' : 'allowed';
      }
    } catch {
      robots = 'unknown';
    }
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const attr = async (selector: string) =>
      (await page
        .locator(selector)
        .first()
        .getAttribute('content', { timeout: 1000 })
        .catch(() => null)) ?? null;
    const meta: HomepageMeta = {
      ogSiteName: await attr('meta[property="og:site_name"]'),
      applicationName: await attr('meta[name="application-name"]'),
      title: (await page.title().catch(() => null)) || null,
    };
    const text = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    return { meta, text, status: response?.status() ?? 0, robots };
  } finally {
    await browser.close();
  }
}

export async function tierACommand(
  env: Env,
  options: { only?: string[]; limit?: number; allowHeldout?: boolean },
): Promise<number> {
  const candidates = await loadCandidates(env.root);
  const only = options.only ? new Set(options.only) : null;
  let todo = candidates.candidates.filter((c) => c.tier === 'A' && (!only || only.has(c.domain)));
  if (!only) todo = todo.filter((c) => options.allowHeldout || !c.heldOut);
  else if (!options.allowHeldout) {
    const heldOut = todo.filter((c) => c.heldOut);
    if (heldOut.length) {
      env.log(
        `tier-a: ${heldOut.map((c) => c.domain).join(', ')} are held out; use --allow-heldout in 14.4.`,
      );
      return 1;
    }
  }
  if (options.limit) todo = todo.slice(0, options.limit);
  const manifestPath = join(env.root, TIER_A_MANIFEST);
  const manifest = manifestSchema.parse(
    JSON.parse((await readFile(manifestPath, 'utf8').catch(() => null)) ?? '{"schemaVersion":1,"stores":{}}'),
  );
  const capturesDir = join(env.root, DB_DIR, 'tier-a-captures');
  await mkdir(capturesDir, { recursive: true });
  const today = env.now().toISOString().slice(0, 10);
  // A tier-A domain a tier-B record already lists as a host (hy-vee.com under hyvee-us, seed 2026-10-11) gets no
  // second record: hosts are unique across the release.
  const covered = new Set<string>();
  for (const name of (await readdir(join(env.root, RECORDS_DIR)).catch(() => [] as string[])).filter((n) =>
    n.endsWith('.json'),
  )) {
    const record = JSON.parse(await readFile(join(env.root, RECORDS_DIR, name), 'utf8')) as {
      id: string;
      hosts: string[];
    };
    for (const host of record.hosts) covered.add(`${host}|${record.id}`);
  }
  const coveredBy = (domain: string, id: string) =>
    [...covered].find((c) => c.startsWith(`${domain}|`) && !c.endsWith(`|${id}`))?.split('|')[1];
  let failed = 0;
  for (const candidate of todo) {
    const refused = hostGate(candidate.domain);
    if (refused) {
      env.log(`${candidate.domain}: refused (${refused}).`);
      failed += 1;
      continue;
    }
    const owner = coveredBy(candidate.domain, tierARecord(candidate.domain, 'x', candidate.id).id);
    if (owner) {
      env.log(`${candidate.domain}: already a host of ${owner}; no tier-A record.`);
      continue;
    }
    try {
      const { meta, text, status, robots } = await captureHomepage(candidate.domain);
      // A bot wall, error page or empty render says nothing about the store: the name falls back to the label.
      const blocked = status >= 400 || text.trim().length < 200 || BOT_WALL.test(text.slice(0, 3000));
      const { name, source } = blocked
        ? displayName({ ogSiteName: null, applicationName: null, title: null }, candidate.domain)
        : displayName(meta, candidate.domain);
      const record = tierARecord(candidate.domain, name, candidate.id);
      await writeFile(join(capturesDir, `${candidate.domain}.txt`), text);
      manifest.stores[candidate.domain] = {
        url: `https://${candidate.domain}/`,
        capturedOn: today,
        sha256: sha256Hex(text),
        length: text.length,
        nameSource: blocked ? `${source} (blocked)` : source,
        status,
        robots,
      };
      await writeJsonAtomic(join(env.root, RECORDS_DIR, `${record.id}.json`), record);
      env.log(`${candidate.domain}: ${record.id} "${name}" (${source}, HTTP ${status}, robots ${robots}).`);
    } catch (error) {
      failed += 1;
      env.log(
        `${candidate.domain}: FAILED ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
    await writeJsonAtomic(manifestPath, manifest);
  }
  env.log(`tier-a: ${todo.length - failed} records written, ${failed} failed.`);
  return failed ? 1 : 0;
}
