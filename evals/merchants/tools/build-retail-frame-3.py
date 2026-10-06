# Builds evals/merchants/retail-frame-3.json (retail-frame.3, generic-reader-protocol.3) from:
#   - the Chrome UX Report (CrUX) top lists for 2026-08 (yyyymm 202608), the global list and 25 country lists, cached by
#     github.com/zakird/crux-top-lists and kept gitignored under evals/merchants/data/crux/ (SHA-256 pinned below);
#   - the agent's storefront-host classification, evals/merchants/frame-3-inputs/classified-hosts.tsv (host, domain,
#     code, region, currency, family; nine subagent batches under classification-rules.txt, from knowledge, no website
#     visited), reconciled by the builder's evals/merchants/frame-3-inputs/reconcile.tsv;
#   - the operator table evals/merchants/frame-3-inputs/operators.tsv (the company running each store; splits lock on it);
#   - the CrUX country lists for 2026-02 (yyyymm 202602), six months earlier, for the persistence rule;
#   - retail-frame.1 (evals/merchants/retail-frame.json) for the Phase 10 probe flag.
# CrUX publishes rank-magnitude buckets, never exact ranks, so the frame carries buckets as they are.
# Run from the repository root: python3 evals/merchants/tools/build-retail-frame-3.py [--check]
import csv, gzip, hashlib, json, os, sys
from collections import Counter

ROOT = os.getcwd()
CRUX = os.path.join(ROOT, 'evals/merchants/data/crux')
OUT = os.path.join(ROOT, 'evals/merchants/retail-frame-3.json')
SEED = 'ai-checkout/phase-12/2026-10-06'
YYYYMM = '202608'
PREV_YYYYMM = '202602'  # persistence rule: the home-list storefront host must be in this list's classified depth too

# The lists the frame reads and how deep each was classified (CrUX rank bucket upper bound).
US_DEPTH, OTHER_DEPTH = 5000, 1000
COUNTRIES = 'US GB DE FR IT ES NL PL SE TR JP KR CN IN ID AU CA MX BR AR SA AE ZA NG EG'.split()
SHA256 = {
    'global': '4ae541994a7e28f2a9ddd33f711effde9346c4128c506782fa77c268d8f3905b',
    'US': '9e7377a7e0aedc3fdc9a579ccfef006566b172ef2687ac9928f687932c5c1a20',
    'GB': '30589d7c1f6f0ec7f3a9814b5604a2c599f66e9c74d284747ac15be08c16c230',
    'DE': '9dc5ffafd22b4bf17513bc3fbc01ecca4b10a6cb6d490ce08423af3ef46ca4a3',
    'FR': '04f01ffa2109e3d1077bc6f1d57484f841ea075153975b5fd488d3898190e86b',
    'IT': 'c1acc7e44a83aaa828558ee84472f25fe6f2170147a93013fd887c84b682a93e',
    'ES': '11c7f19cdff2fd0b0219c934c06c614b4e9f121d070308dcb3a36950b5af6e40',
    'NL': 'c0de01557c356ac727d41ca0d99e1b277a02543ec15b41d04542cb937410a2a9',
    'PL': '24daf544610c06e7263c371668d813a06cb1c30e397814ca98f26238f1813c3b',
    'SE': '58640f673a6f0eb52f5018f54077b698c1a1a9002af8b281d0abba3c53479a31',
    'TR': 'a5a154881172f12fc6f5420c260adf67117ee6b23e5f97bf52163662c80aba61',
    'JP': 'fba141cfa34e87f101a1408dffa82f0578f41c6a07e283a46516cd05b8827722',
    'KR': '6b89ab7cd409d906aee498b806f84f059a0f4642b67b323d666b638d25d1c64e',
    'CN': 'f49fc217deb67cf003333f1eb2b88c158c3999e4f78ab42b6357db6c6a8e64e0',
    'IN': 'dd258ec4ff2cf6133a8d731b88f32d66734dd2d3980e871ac84c8156e6042914',
    'ID': '32ecec90fb08a2b61e4ef6a5a08b28bd0cce04a7d180f7b52373e4f1d2a53cff',
    'AU': '1f5e74f01f378209fba085a00b03cbf86f4c3d13bc94f76c6c686f5901367126',
    'CA': '27271fb586459235f84a04b142912f10914f45fe9c99c43c51793bfa0d614e9b',
    'MX': 'bb74098ef7877fbde2cd65b667aae2d69257f5c193293bb82d11048e8f11d9a6',
    'BR': '90a70ea16bfe440519c9defc3310bee42bae903e0e80078177020247b859aad4',
    'AR': 'f9894efa557f060548b0b9b68a5051e83da5d006230ddc84e825d567275f0c1e',
    'SA': 'd8578bd5066212bcdc83e5c80f2031cec713bfc32e596d465b443e3f76394ad7',
    'AE': '8ac3f4f213da60c9f4daa2a98805ce00e01cc767c13e1cf335ab52e89503dc52',
    'ZA': 'a7b29434cb657026d708fb15cf290b9a8babd840ba2bec904803999b240b5e27',
    'NG': '399497320f03f07ab4eca3fb28457cfbf9997cfa92883c37c0e805bac9a49edd',
    'EG': 'd92cbd7465772a7a0156f5631c29a996c97de9c233aa45526d965943231c15fd',
}
PREV_SHA256 = {
    'US': '2a88ed7c7a871d1decb06ff1048c1740692baee9529b87c78157051e97cbe2aa',
    'GB': '45f551dd4ecd67614403e1b17c701dc65ebf4eb8be3e2e44f52c2075805b0638',
    'DE': '4967c3d94f7ece0a5e6e1e84b5e52eea552ce8c478dcb634be3c3538277bb995',
    'FR': 'cb73042cea2efbd83a4d2b38060c172ff2fb636b082b2d6d2c4881b5492eac3e',
    'IT': '2e4fffb55b0bc0c97add26b819a7a28e1bc1f41b2b9c742baad43e6db2e2c2e9',
    'ES': '0075bf45c9c6c0ffbbfc6c8ff8b75c1e38ab49fd40b6053a463e1a2e84274bb4',
    'NL': '49e91514306ee033eed98f0e4181d242b8b18d56ccba90df2f6312a53e710aaa',
    'PL': '24eb885d90f7d69f75b3778f318d79d2725bc8a300d38b0c2d18c6f61006e53d',
    'SE': 'dc387c8097aca0d10165414bffb9bbe073123a4440488758291dcb5ac41163cb',
    'TR': '68207ed38d2171400905e42141044f4db3bc92a64cddf7a54b983e69fcc93cb8',
    'JP': 'c38a275cfedff6359a66e46d2834d408f47a1d6874c05068e02aa08ee785b8bb',
    'KR': '51848a1b4761dc0a0999eb0be0c30a78a712ce4b0afadcc6243f8dbff27d284e',
    'CN': '8ccb67ba312f1c77fe608c757b3594d994ba252de83dfda904719893429d2afd',
    'IN': '5de42573f11c335af453b48467cdd0bc582746f4a38281698b3fefa1e52f289b',
    'ID': '4eb79c78a1bea72fcb6a59ebcb4c285ad52d3a259f31f0390d69543303ed1f8c',
    'AU': 'c6c104b4cfd8ca5e4f3660200b0881fb9619fbe36c2832e865b2ef4434d07e35',
    'CA': 'e10bbc25c7b830246f96c67eb820a99e0256d93ffdc732346c334571e9f77100',
    'MX': '24efd19e098a042ea003ea1c4010afaf2918a4ea94af0e205e8e76b154870c7d',
    'BR': 'e925aa71b6c877a05b1ac8337a368a16bac64188f900633d3cede1e296c58159',
    'AR': '817656006c99de4bdfab81bfe3d719020c6ed13e22d7bfec0586cde109eafb47',
    'SA': '2ce0030b48e97989a2ad472c24e05685da6624a254489eafbaa33749f33e1883',
    'AE': 'bb787a03d738b89bb578fb304782eb669bf4451d0623c4430d918d6ec2c5589e',
    'ZA': 'ec818199afc99a48916e6899dcdcbee74bb9b3a98baac8f6efb3c553dd252553',
    'NG': '49f4dba16e537a0402bc988e537f083eb312c50d917c4c01b75153978a4d429f',
    'EG': 'd403d51affeb9e10cbb4b3234760f005b486c902fe7cd2271c33520385053dd6',
}
BUCKET = {1000: 'top-1k', 5000: '1k-5k', 10000: '5k-10k', 50000: '10k-50k', 100000: '50k-100k', 500000: '100k-500k',
          1000000: '500k-1m'}
BAND_ORDER = ['top-1k', '1k-5k', '5k-10k']

GROUP = {'US': 'us'}
for c in 'CA MX BR AR'.split(): GROUP[c] = 'canada-latam'
for c in 'GB DE FR IT ES NL PL SE TR'.split(): GROUP[c] = 'europe'
for c in 'JP KR CN IN ID AU'.split(): GROUP[c] = 'asia-pacific'
for c in 'SA AE ZA NG EG'.split(): GROUP[c] = 'middle-east-africa'

CODES = set('''eligible legacy-named-merchant cross-border-marketplace prescription-or-pharmacy adult-retailer card-unusable-market
mostly-digital-goods no-own-checkout business-supplier registry-service not-a-store multi-market-domain
duplicate-of-another-domain defunct-2025 sensitive-goods
no-fixed-price-cart-or-members-only carrier-device-shop'''.split())
LEGACY = {'amazon.com', 'bestbuy.com', 'newegg.com'}

# Registrable domain: the last two labels, or three under these second-level public suffixes (the ones the 25 lists use).
SECOND_LEVEL = set('''co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk nhs.uk com.au net.au org.au edu.au gov.au co.jp ne.jp or.jp
ac.jp go.jp co.kr or.kr go.kr ac.kr ne.kr re.kr com.cn net.cn org.cn gov.cn edu.cn co.in net.in org.in gov.in ac.in firm.in
nic.in res.in co.id go.id ac.id or.id web.id my.id com.mx gob.mx org.mx edu.mx net.mx com.br gov.br org.br net.br edu.br
jus.br leg.br com.ar gob.ar org.ar net.ar edu.ar com.tr gov.tr org.tr edu.tr net.tr gen.tr com.sa gov.sa edu.sa org.sa net.sa
co.ae gov.ae ac.ae net.ae org.ae co.za gov.za org.za ac.za com.ng gov.ng org.ng edu.ng net.ng com.eg gov.eg edu.eg org.eg
com.pl net.pl org.pl gov.pl com.tw com.hk com.sg com.my co.th com.ph com.vn com.co com.pe com.pk co.nz qc.ca gc.ca'''.split())


def regdom(host):
    p = host.split(':')[0].lower().rstrip('.').split('.')
    return '.'.join(p[-3:]) if len(p) >= 3 and '.'.join(p[-2:]) in SECOND_LEVEL else '.'.join(p[-2:])


def key(purpose, domain):
    return hashlib.sha256(f'{SEED}|{purpose}|{domain}'.encode()).hexdigest()


def read_list(name, month=YYYYMM, pins=SHA256):
    path = os.path.join(CRUX, f'global-{month}.csv.gz' if name == 'global' else f'country-{name.lower()}-{month}.csv.gz')
    raw = open(path, 'rb').read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != pins[name]:
        sys.exit(f'{path}: SHA-256 {digest} is not the pinned {pins[name]}')
    best = {}
    for row in csv.DictReader(gzip.decompress(raw).decode().splitlines()):
        host, rank = row['origin'].split('://', 1)[1], int(row['rank'])
        best[host] = min(rank, best.get(host, rank))
    return best


lists = {name: read_list(name) for name in ['global'] + COUNTRIES}
prev_lists = {name: read_list(name, PREV_YYYYMM, PREV_SHA256) for name in COUNTRIES}
depth = {c: US_DEPTH if c == 'US' else OTHER_DEPTH for c in COUNTRIES}
classified = set(h for c in COUNTRIES for h, r in lists[c].items() if r <= depth[c])

INPUTS = os.path.join(ROOT, 'evals/merchants/frame-3-inputs')


def rows(name):
    for n, line in enumerate(open(os.path.join(INPUTS, name)), 1):
        if line.startswith('#') or not line.strip(): continue
        yield f'{name}:{n}', line.rstrip('\n').split('\t')


raw = {}
for where, (host, dom, code, region, cur, family) in rows('classified-hosts.tsv'):
    if host in raw: sys.exit(f'{where} {host}: duplicate host')
    raw[host] = {'domain': dom, 'code': code, 'region': None if region == '-' else region,
                 'currency': None if cur == '-' else cur, 'family': family}

# Builder reconciliation (reconcile.tsv): host rows, then family renames, then domain rows.
host_fix, family_fix, domain_fix, added = {}, {}, {}, []
for where, cols in rows('reconcile.tsv'):
    if cols[0] == 'host': host_fix[cols[1]] = cols[2:5]
    elif cols[0] == 'add': added.append(cols[1:7])
    elif cols[0] == 'family': family_fix[cols[1]] = cols[2]
    elif cols[0] == 'domain': domain_fix[cols[1]] = cols[2:6]
    else: sys.exit(f'{where}: unknown row kind {cols[0]}')
for host, (code, region, cur) in host_fix.items():
    if host not in raw: sys.exit(f'reconcile.tsv: unknown host {host}')
    raw[host]['code'] = code
    if region: raw[host]['region'], raw[host]['currency'] = region, cur
for h in raw.values(): h['family'] = family_fix.get(h['family'], h['family'])
for dom, (code, region, cur, family) in domain_fix.items():
    members = [host for host, h in raw.items() if h['domain'] == dom]
    if not members: sys.exit(f'reconcile.tsv: unknown domain {dom}')
    region, cur = (None if region == '-' else region), (None if cur == '-' else cur)
    keep = [x for x in members if raw[x]['code'] == code and raw[x]['region'] == region] or members
    for x in members:
        if x in keep: raw[x].update(code=code, region=region, currency=cur, family=family)
        else: del raw[x]
for host, dom, code, region, cur, family in added:
    if host in raw: sys.exit(f'reconcile.tsv: add of a classified host {host}')
    raw[host] = {'domain': dom, 'code': code, 'region': region, 'currency': cur, 'family': family}

hosts = {}
for host, h in raw.items():
    where = f'host {host}'
    if host not in classified: sys.exit(f'{where}: not in the classified part of any list')
    if regdom(host) != h['domain']: sys.exit(f"{where}: domain {h['domain']} is not the registrable domain {regdom(host)}")
    if h['code'] not in CODES: sys.exit(f"{where}: unknown code {h['code']}")
    if h['code'] == 'eligible' and not (h['region'] and h['currency']): sys.exit(f'{where}: eligible needs region and currency')
    hosts[host] = h

domains = {}
for host, h in sorted(hosts.items()):
    d = domains.setdefault(h['domain'], {'hosts': [], **{k: h[k] for k in ('code', 'region', 'currency', 'family')}})
    for k in ('code', 'region', 'currency', 'family'):
        if d[k] != h[k]: sys.exit(f"{h['domain']}: hosts disagree on {k} ({d[k]} / {h[k]})")
    d['hosts'].append(host)

probe = {d['domain'] for d in json.load(open(os.path.join(ROOT, 'evals/merchants/retail-frame.json')))['domains'] if d['probeSite']}


def bucket_in(name, hs, limit=None):
    ranks = [lists[name][h] for h in hs if h in lists[name] and (limit is None or lists[name][h] <= limit)]
    return BUCKET[min(ranks)] if ranks else None


family_operator, domain_operator = {}, {}
for where, cols in rows('operators.tsv'):
    if cols[0] == 'family': family_operator[cols[1]] = cols[2]
    elif cols[0] == 'domain': domain_operator[cols[1]] = cols[2]
    else: sys.exit(f'{where}: unknown row kind {cols[0]}')
families = {d['family'] for d in domains.values()}
for f in family_operator:
    if f not in families: sys.exit(f'operators.tsv: unknown family {f}')
for dm in domain_operator:
    if dm not in domains: sys.exit(f'operators.tsv: unknown domain {dm}')


def persistent(name, hs):
    return any(prev_lists[name].get(h, depth[name] + 1) <= depth[name] for h in hs)


entries = []
for dom, d in sorted(domains.items()):
    seen_in = {c: b for c in COUNTRIES if (b := bucket_in(c, d['hosts'], depth[c]))}
    home = d['region'] if d['region'] in COUNTRIES else None
    band = seen_in.get(home) if home else None
    code = 'legacy-named-merchant' if dom in LEGACY else d['code']
    if code == 'eligible' and d['region'] in ('RU', 'BY'): code = 'card-unusable-market'
    if code == 'eligible' and home is None: code = 'region-not-in-country-set'
    elif code == 'eligible' and band is None: code = 'outside-home-list'
    elif code == 'eligible' and not persistent(home, d['hosts']): code = 'not-persistently-popular'
    in_home = [h for h in d['hosts'] if home and lists[home].get(h, depth[home] + 1) <= depth[home]]
    entry = min(in_home, key=lambda h: (lists[home][h], d['hosts'].index(h))) if in_home else None
    entries.append({
        'domain': dom, 'band': band, 'eligible': code == 'eligible', 'exclusion': None if code == 'eligible' else code,
        'probeSite': dom in probe, 'region': d['region'], 'currency': d['currency'],
        'regionGroup': GROUP.get(d['region']) if d['region'] else None, 'family': d['family'],
        'operator': domain_operator.get(dom, family_operator.get(d['family'], d['family'])), 'homeList': home,
        'lists': seen_in, 'globalBucket': bucket_in('global', d['hosts']), 'entryHost': entry, 'hosts': d['hosts'],
    })

# One storefront per retailer family per country: among a family's eligible domains in one region, the most popular band
# wins, then the lowest SHA-256("<seed>|retailer-family|<domain>"); the others are same-retailer-other-domain.
groups = {}
for e in entries:  # one storefront per brand family per country; splits lock on operator instead
    if e['eligible']: groups.setdefault((e['family'], e['region']), []).append(e)
for members in groups.values():
    members.sort(key=lambda e: (BAND_ORDER.index(e['band']), key('retailer-family', e['domain'])))
    for e in members[1:]: e['eligible'], e['exclusion'] = False, 'same-retailer-other-domain'

order = {b: i for i, b in enumerate(BAND_ORDER)}
entries.sort(key=lambda e: (order.get(e['band'], 9), e['domain']))
eligible = [e for e in entries if e['eligible']]
counts = {
    'eligibleByBand': {s: {b: sum(1 for e in eligible if e['band'] == b and (e['regionGroup'] == 'us') == (s == 'us'))
                           for b in BAND_ORDER} for s in ('us', 'non-us')},
    'eligibleByCountry': {c: {b: n for b in BAND_ORDER if (n := sum(1 for e in eligible if e['homeList'] == c and e['band'] == b))}
                          for c in COUNTRIES},
    'eligibleByRegionGroup': dict(sorted(Counter(e['regionGroup'] for e in eligible).items())),
    'eligibleByCurrency': dict(sorted(Counter(e['currency'] for e in eligible).items())),
    'eligible': len(eligible),
    'excluded': dict(sorted(Counter(e['exclusion'] for e in entries if not e['eligible']).items())),
    'domains': len(entries),
    'storefrontHosts': len(hosts),
}

frame = {
    'frame': 'retail-frame.3',
    'frozenOn': '2026-10-05',
    'source': (f'Chrome UX Report (CrUX) top lists, month {YYYYMM[:4]}-{YYYYMM[4:]} (yyyymm {YYYYMM}): the global list and the '
               'country lists of ' + ' '.join(COUNTRIES) + ', as cached by github.com/zakird/crux-top-lists '
               '(data/global/202608.csv.gz, data/country/<cc>/202608.csv.gz). CrUX ranks origins by completed page loads of '
               'opted-in Chrome users in rank-magnitude buckets (1k, 5k, 10k, ...), unordered within a bucket. "CrUX datasets '
               'by Google are licensed under a Creative Commons Attribution 4.0 International License" '
               '(https://developer.chrome.com/docs/crux/methodology). Local copies gitignored under evals/merchants/data/crux/; '
               'SHA-256 pinned in evals/merchants/tools/build-retail-frame-3.py. This frame is a filtered and classified '
               'subset of those lists and is modified from them (CC BY 4.0 section 3(a)(1)(B)): buckets are aggregated per '
               'registrable domain, and the 2026-02 country lists (yyyymm 202602) are used only for the persistence rule.'),
    'classification': ('Agent-classified storefront hosts of online sellers of physical goods (claude-code/claude-opus-5-5, '
                       '2026-10-05, nine parallel subagent batches under one rule sheet, merged and reviewed by the builder), '
                       'no website visited: every origin in the U.S. list to bucket 5k (ranks 1-5,000) and in the 24 other '
                       'country lists to bucket 1k. Inputs: evals/merchants/frame-3-inputs/ (classified-hosts.tsv, '
                       'reconcile.tsv, operators.tsv, classification-rules.txt). region / '
                       'currency: the storefront a visitor in the United States gets at the domain without choosing a country. '
                       'band: the bucket of the domain\'s best storefront host in its home list (the U.S. list for region US, '
                       'else its region\'s list). Rules and codes: docs/evals/generic-reader-protocol.md#retail-frame'),
    'supersedes': ('retail-frame.2 for the reader evaluation (retail-frame.2 stays committed, unused); retail-frame.1 stays '
                   'frozen for the merchant-pipeline held-out list'),
    'bands': {'top-1k': 'CrUX bucket 1000 (ranks 1-1,000)', '1k-5k': 'CrUX bucket 5000 (ranks 1,001-5,000)',
              '5k-10k': 'CrUX bucket 10000 (ranks 5,001-10,000; not classified in this frame)'},
    'lists': {'classifiedDepth': {c: BUCKET[depth[c]] for c in COUNTRIES}, 'sha256': SHA256,
              'persistence': {'yyyymm': PREV_YYYYMM, 'sha256': PREV_SHA256}},
    'regionGroups': {g: ' '.join(c for c in COUNTRIES if GROUP[c] == g) for g in
                     ('us', 'canada-latam', 'europe', 'asia-pacific', 'middle-east-africa')},
    'counts': counts,
    'domains': entries,
}
text = json.dumps(frame, indent=1, ensure_ascii=False) + '\n'
if '--check' in sys.argv:
    same = open(OUT).read() == text
    print(('ok ' if same else 'MISMATCH ') + hashlib.sha256(text.encode()).hexdigest())
    sys.exit(0 if same else 1)
open(OUT, 'w').write(text)
print(json.dumps(counts, indent=1))
print(len(entries), hashlib.sha256(text.encode()).hexdigest())
