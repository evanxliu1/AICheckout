// The frozen candidate list (plan section 5): tier B from the hand-authored groups file, tier A from the U.S. eligible
// domains of the frozen retail-frame-3.json, the 60 held-out domains included and marked. Gates: hosts are never a
// public suffix or a shared platform domain; a tier-A domain whose label matches a catalog brand name moves to tier B.
//   pipeline merchants candidates           write evals/merchants/db/candidates.json
//   pipeline merchants candidates --check   fail when the committed file differs from a rebuild
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CATALOG_V3 } from '../../../../packages/rewards-core/src/catalog-v3.ts';
import { sha256Hex } from '../hash.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import {
  CANDIDATES_FILE,
  FRAME_FILE,
  GROUPS,
  GROUPS_FILE,
  HELDOUT_FILE,
  candidatesFileSchema,
  domainSchema,
} from './files.ts';
import type { Candidate, CandidatesFile, Group } from './files.ts';

/** Shared platform domains where many unrelated stores live: never a record host (the matcher would claim them all). */
export const PLATFORM_DOMAINS = new Set([
  'myshopify.com',
  'squarespace.com',
  'wixsite.com',
  'webflow.io',
  'bigcartel.com',
  'godaddysites.com',
  'square.site',
  'ecwid.com',
  'storenvy.com',
  'weebly.com',
  'wordpress.com',
  'blogspot.com',
  'github.io',
  'netlify.app',
  'vercel.app',
  'herokuapp.com',
]);
/** Public suffixes a careless host could be (a short offline list; the real PSL is not needed for 500 authored hosts). */
export const PUBLIC_SUFFIXES = new Set([
  'com',
  'net',
  'org',
  'co',
  'io',
  'app',
  'us',
  'uk',
  'co.uk',
  'org.uk',
  'com.au',
  'co.jp',
  'com.br',
  'com.mx',
  'co.in',
  'co.kr',
  'com.cn',
  'com.tr',
  'com.ar',
  'co.za',
  'com.sa',
  'eu',
  'de',
  'fr',
  'it',
  'es',
  'nl',
  'pl',
  'se',
  'ca',
  'lu',
  'info',
  'gov',
  'edu',
  'tv',
]);

/** Null when the host may be authored; otherwise why not. */
export function hostGate(host: string): string | null {
  if (!domainSchema.safeParse(host).success) return 'not a host';
  if (PUBLIC_SUFFIXES.has(host)) return 'public suffix';
  const labels = host.split('.');
  if (labels.length === 2 && PUBLIC_SUFFIXES.has(host)) return 'public suffix';
  for (let i = 0; i < labels.length; i += 1) {
    const suffix = labels.slice(i).join('.');
    if (PLATFORM_DOMAINS.has(suffix)) return `platform domain ${suffix}`;
  }
  return null;
}

/** Letters and digits only, lowercase: "L.L.Bean" → "llbean", "Barnes & Noble" → "barnesnoble". */
export const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The registrable label of a domain: "shop.example.com" → "example", "example.co.uk" → "example". */
export function domainLabel(domain: string): string {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const suffix = labels.slice(i + 1).join('.');
    if (PUBLIC_SUFFIXES.has(suffix)) return labels[i];
  }
  return labels[Math.max(0, labels.length - 2)];
}

/** The brand-name gate: a tier-A domain whose label is a catalog brand's normalised name (or that name with "the",
 * "shop" or "store" around it) belongs in tier B. Returns the brand ids that match. */
export function brandNameGate(domain: string, brands: readonly { id: string; name: string }[]): string[] {
  const label = normalizeName(domainLabel(domain));
  const variants = new Set([
    label,
    label.replace(/^the/, ''),
    label.replace(/(shop|store|online|usa|us)$/, ''),
  ]);
  return brands.filter((brand) => variants.has(normalizeName(brand.name))).map((brand) => brand.id);
}

const groupEntry = z.strictObject({
  domain: domainSchema,
  id: z.string().optional(),
  hosts: z.array(domainSchema).optional(),
  brandIds: z.array(z.string()).optional(),
  note: z.string().optional(),
});
const groupsFileSchema = z.strictObject({
  description: z.string(),
  groups: z.partialRecord(z.enum(GROUPS), z.array(groupEntry)),
  legacy: z.array(groupEntry),
  brandsWithoutStoreSite: z.record(z.string(), z.string()),
});
const frameSchema = z.looseObject({
  domains: z.array(
    z.looseObject({
      domain: z.string(),
      eligible: z.boolean(),
      region: z.string().nullable(),
      band: z.string().nullable(),
    }),
  ),
});
const heldOutSchema = z.looseObject({
  list: z.string(),
  domains: z.array(z.looseObject({ domain: z.string() })),
});

export interface CandidateInputs {
  groups: z.infer<typeof groupsFileSchema>;
  frame: z.infer<typeof frameSchema>;
  heldOut: z.infer<typeof heldOutSchema>;
  brands: readonly { id: string; name: string }[];
  hashes: { groups: string; frame: string; heldOut: string };
  frozenOn: string;
}

export function buildCandidates(inputs: CandidateInputs): CandidatesFile {
  const byDomain = new Map<string, Candidate>();
  const heldOut = new Set(inputs.heldOut.domains.map((d) => d.domain));
  const add = (domain: string, group: Group, extra: Partial<Candidate> = {}) => {
    const existing = byDomain.get(domain);
    if (existing) {
      if (!existing.groups.includes(group)) existing.groups.push(group);
      if (extra.brandIds) existing.brandIds = [...new Set([...(existing.brandIds ?? []), ...extra.brandIds])];
      if (extra.id) existing.id = extra.id;
      if (extra.hosts) existing.hosts = extra.hosts;
      return;
    }
    byDomain.set(domain, { domain, tier: 'B', groups: [group], heldOut: heldOut.has(domain), ...extra });
  };
  for (const [group, entries] of Object.entries(inputs.groups.groups) as [
    Group,
    z.infer<typeof groupEntry>[],
  ][])
    for (const entry of entries)
      add(entry.domain, group, {
        ...(entry.id ? { id: entry.id } : {}),
        ...(entry.hosts ? { hosts: entry.hosts } : {}),
        ...(entry.brandIds ? { brandIds: entry.brandIds } : {}),
      });
  for (const entry of inputs.groups.legacy)
    add(entry.domain, 'legacy', {
      ...(entry.id ? { id: entry.id } : {}),
      ...(entry.brandIds ? { brandIds: entry.brandIds } : {}),
    });
  let movedToB = 0;
  const tierA = (domain: string, group: Group, band: string) => {
    if (byDomain.has(domain)) return;
    const brandIds = brandNameGate(domain, inputs.brands);
    if (brandIds.length) {
      movedToB += 1;
      byDomain.set(domain, {
        domain,
        tier: 'B',
        groups: [group],
        brandIds,
        heldOut: heldOut.has(domain),
        band: 'moved-to-b',
      });
    } else byDomain.set(domain, { domain, tier: 'A', groups: [group], heldOut: heldOut.has(domain), band });
  };
  for (const entry of inputs.frame.domains)
    if (entry.eligible && entry.region === 'US') tierA(entry.domain, 'top-stores', entry.band ?? 'unbanded');
  for (const domain of heldOut) tierA(domain, 'held-out-only', 'heldout-list');
  const candidates = [...byDomain.values()].sort((a, b) => (a.domain < b.domain ? -1 : 1));
  for (const candidate of candidates) {
    for (const host of candidate.hosts ?? [candidate.domain]) {
      const refused = hostGate(host);
      if (refused) throw new Error(`candidates: ${candidate.domain} host ${host}: ${refused}.`);
    }
    for (const id of candidate.brandIds ?? [])
      if (!inputs.brands.some((brand) => brand.id === id))
        throw new Error(`candidates: ${candidate.domain} names unknown brand ${id}.`);
  }
  const hosts = candidates.flatMap((c) => c.hosts ?? [c.domain]);
  if (new Set(hosts).size !== hosts.length) throw new Error('candidates: a host appears in two candidates.');
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const candidate of candidates) for (const group of candidate.groups) groups[group] += 1;
  return candidatesFileSchema.parse({
    schemaVersion: 1,
    list: 'merchant-candidates.1',
    frozenOn: inputs.frozenOn,
    heldOutList: inputs.heldOut.list,
    sources: [
      {
        file: GROUPS_FILE,
        sha256: inputs.hashes.groups,
        contributes:
          'tier-B domains by group, record ids and hosts of processors and legacy stores, brand ids',
      },
      {
        file: FRAME_FILE,
        sha256: inputs.hashes.frame,
        contributes: 'tier-A domains: the U.S. eligible domains (domain names only)',
      },
      {
        file: HELDOUT_FILE,
        sha256: inputs.hashes.heldOut,
        contributes: 'the 60 held-out domains, marked heldOut (domain names only)',
      },
    ],
    counts: {
      total: candidates.length,
      tierA: candidates.filter((c) => c.tier === 'A').length,
      tierB: candidates.filter((c) => c.tier === 'B').length,
      heldOut: candidates.filter((c) => c.heldOut).length,
      movedToB,
      groups,
    },
    candidates,
  });
}

export async function loadCandidateInputs(root: string, frozenOn: string): Promise<CandidateInputs> {
  const text = async (file: string) => readFile(join(root, file), 'utf8');
  const [groupsText, frameText, heldOutText] = await Promise.all([
    text(GROUPS_FILE),
    text(FRAME_FILE),
    text(HELDOUT_FILE),
  ]);
  return {
    groups: groupsFileSchema.parse(JSON.parse(groupsText)),
    frame: frameSchema.parse(JSON.parse(frameText)),
    heldOut: heldOutSchema.parse(JSON.parse(heldOutText)),
    brands: CATALOG_V3.brands,
    hashes: { groups: sha256Hex(groupsText), frame: sha256Hex(frameText), heldOut: sha256Hex(heldOutText) },
    frozenOn,
  };
}

export async function candidatesCommand(env: Env, { check }: { check: boolean }): Promise<number> {
  const path = join(env.root, CANDIDATES_FILE);
  const existing = await readFile(path, 'utf8').catch(() => null);
  const frozenOn = existing
    ? candidatesFileSchema.parse(JSON.parse(existing)).frozenOn
    : env.now().toISOString().slice(0, 10);
  const built = buildCandidates(await loadCandidateInputs(env.root, frozenOn));
  const text = JSON.stringify(built, null, 2) + '\n';
  if (check) {
    if (existing === text) {
      env.log(
        `candidates.json is up to date (${built.counts.total} candidates: tier A ${built.counts.tierA}, tier B ${built.counts.tierB}, held out ${built.counts.heldOut}).`,
      );
      return 0;
    }
    env.log(
      existing === null
        ? 'candidates.json is missing.'
        : 'candidates.json is stale; run `pipeline merchants candidates`.',
    );
    return 1;
  }
  if (existing && existing !== text)
    env.log('candidates.json changed: the list is meant to be frozen; commit the change deliberately.');
  await writeJsonAtomic(path, built);
  env.log(
    `Wrote ${CANDIDATES_FILE}: ${built.counts.total} candidates (tier A ${built.counts.tierA}, tier B ${built.counts.tierB}, held out ${built.counts.heldOut}, moved to B ${built.counts.movedToB}).`,
  );
  return 0;
}

export async function loadCandidates(root: string): Promise<CandidatesFile> {
  return candidatesFileSchema.parse(JSON.parse(await readFile(join(root, CANDIDATES_FILE), 'utf8')));
}
