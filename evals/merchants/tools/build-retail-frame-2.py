# Builds evals/merchants/retail-frame-2.json (retail-frame.2) from retail-frame.1, the agent's worldwide retailer
# lists (evals/merchants/frame-2-inputs/retailers-{a,b}.txt: domain, region, currency; classified from knowledge, no
# website visited) and the gitignored Tranco 647LX copy (evals/merchants/data/tranco-647LX.csv). Committed as the
# frame's audit trail; it writes exact ranks only to the gitignored evals/merchants/data/frame2/frame-2-ranks.json.
# Run from the repository root: python3 evals/merchants/tools/build-retail-frame-2.py
import hashlib, json, os, re

ROOT = os.getcwd()
DATA = os.path.join(ROOT, 'evals/merchants/data')
SEED = 'ai-checkout/phase-12/2026-10-06'

ranks = {}
for line in open(os.path.join(DATA, 'tranco-647LX.csv')):
    r, d = line.strip().split(',', 1)
    ranks[d] = int(r)

def band(r):
    if r is None or r > 100000: return None
    return 'top-1k' if r <= 1000 else '1k-10k' if r <= 10000 else '10k-100k'

def key(purpose, domain):
    return hashlib.sha256(f'{SEED}|{purpose}|{domain}'.encode()).hexdigest()

GROUP = {'US': 'us'}
for c in 'CA MX BR AR CL CO PE'.split(): GROUP[c] = 'canada-latam'
for c in 'GB IE DE FR ES PT IT NL BE AT CH PL CZ SK RO HU BG GR SE DK NO FI TR UA RU BY'.split(): GROUP[c] = 'europe'
for c in 'JP KR CN HK TW SG MY ID TH PH VN IN PK BD LK AU NZ KZ'.split(): GROUP[c] = 'asia-pacific'
for c in 'AE SA IL EG ZA NG KE'.split(): GROUP[c] = 'middle-east-africa'

# Global .com brand domains whose storefront for a visitor in the United States is a U.S. store in USD (from knowledge).
US_STOREFRONT = set('''lacoste.com burberry.com allsaints.com tedbaker.com reiss.com sezane.com massimodutti.com clarks.com
selfridges.com harrods.com endclothing.com luisaviaroma.com yoox.com'''.split())
# retail-frame.1 non-us-online-retailer domains that serve U.S. visitors a USD storefront (the rule that excluded them is lifted)
V1_LIFTED_US = set('''asos.com farfetch.com vestiairecollective.com boohoo.com mytheresa.com nastygal.com prettylittlething.com
princesspolly.com ssense.com whitefoxboutique.com'''.split())

EXCLUDE = {}
def ex(code, names):
    for n in names.split(): EXCLUDE[n] = code
ex('prescription-or-pharmacy', '''boots.com superdrug.com chemistwarehouse.com.au drogasil.com.br matsukiyo.co.jp apotea.se
shoppersdrugmart.ca londondrugs.com well.ca doz.pl superpharm.pl priceline.com.au rexall.ca lenskart.com watsons.com.my
watsons.co.th watsons.com.hk guardian.com.my mannings.com.hk''')
ex('not-a-store', '''idealo.de kakaku.com ceneo.pl danawa.com bestprice.gr zap.co.il subito.it interpark.com cosme.com lpp.com
swiggy.com aeon.com''')
ex('mostly-digital-goods', 'booth.pm')
ex('adult-retailer', 'lovehoney.co.uk melonbooks.co.jp')
ex('business-supplier', 'monotaro.com askul.co.jp')
ex('cross-border-marketplace', 'aliexpress.com aliexpress.ru')
ex('card-unusable-market', '''ozon.ru wb.ru wildberries.ru dns-shop.ru mvideo.ru eldorado.ru citilink.ru lamoda.ru detmir.ru lenta.com
vkusvill.ru sbermegamarket.ru megamarket.ru leroymerlin.ru lemanapro.ru goldapple.ru vseinstrumenti.ru 21vek.by''')
ex('no-own-checkout', 'primark.com lidl.co.uk aldi.co.uk aldi-sued.de sobeys.com dmart.in pinduoduo.com bmstores.co.uk')
ex('defunct-2025', 'feelunique.com thebay.com')
ex('duplicate-of-another-domain', 'vente-privee.com')
for n in '''pullandbear.com bershka.com stradivarius.com oysho.com calzedonia.com intimissimi.com tezenis.com benetton.com snipes.com
deichmann.com breuninger.com boozt.com lyko.com clasohlson.com muji.com gu-global.com adlibris.com action.com reserved.com ccc.eu
answear.com primor.eu thomann.de sportsdirect.com riverisland.com thewhitecompany.com smythstoys.com spacenk.com beautybay.com roots.com
aritzia.com cottonon.com showpo.com mecca.com mecca.com.au yesasia.com zalando.com kjell.com sinsay.com zeeman.com lefties.com
marksandspencer.com lookfantastic.com debenhams.com kiabi.com etam.com celio.com maisonsdumonde.com'''.split():
    EXCLUDE[n] = 'multi-market-domain'

# Retailer families: storefronts of one retailer (or one retailer group's shared storefront platform) in several countries.
FAMILY = {}
def fam(name, names):
    for n in names.split(): FAMILY[n] = name
fam('mediamarkt-saturn', 'mediamarkt.de mediamarkt.es mediamarkt.nl mediamarkt.at mediamarkt.ch mediamarkt.hu mediamarkt.com.tr saturn.de')
fam('elkjop', 'elkjop.no elgiganten.se elgiganten.dk gigantti.fi')
fam('power', 'power.no power.dk power.fi')
fam('mercadolibre', 'mercadolibre.com.mx mercadolivre.com.br mercadolibre.com.ar mercadolibre.cl mercadolibre.com.co mercadolibre.com.pe')
fam('falabella', 'falabella.com falabella.com.co falabella.com.pe falabella.com.ar sodimac.cl sodimac.com.ar sodimac.com.pe homecenter.com.co tottus.com.pe')
fam('magalu', 'magazineluiza.com.br magalu.com.br')
fam('casasbahia', 'casasbahia.com.br pontofrio.com.br extra.com.br')
fam('colcomercio', 'alkosto.com ktronix.com')
fam('fnac', 'fnac.com fnac.es fnac.pt fnac.be lafnac.com')
fam('veepee', 'veepee.fr vente-privee.com')
fam('ahold-nl', 'ah.nl albertheijn.nl')
fam('alibaba-cn', 'taobao.com tmall.com')
fam('lotte', 'lotteon.com lotteimall.com lotte.com')
fam('ssg', 'ssg.com emart.com')
fam('gmarket', 'gmarket.co.kr auction.co.kr')
fam('loblaw', 'loblaws.ca pcexpress.ca realcanadiansuperstore.ca')
fam('walmart', 'walmart.com walmart.ca walmart.com.mx bodegaaurrera.com.mx sams.com.mx lider.cl')
fam('souledstore', 'thesouledstore.com souledstore.com')
fam('jd', 'jd.com jd.id')
fam('renner', 'renner.com.br lojasrenner.com.br')
fam('shopee', 'shopee.tw shopee.sg shopee.com.my shopee.co.id shopee.co.th shopee.ph shopee.vn shopee.com.br')
fam('lazada', 'lazada.sg lazada.com.my lazada.co.id lazada.co.th lazada.com.ph lazada.vn')
fam('zalora', 'zalora.com.my zalora.sg zalora.com.ph')
fam('daraz', 'daraz.pk daraz.com.bd daraz.lk')
fam('jumia', 'jumia.com.ng jumia.co.ke jumia.com.eg')
fam('leclerc', 'e.leclerc leclercdrive.fr')
fam('flipkart', 'flipkart.com shopsy.in')
fam('digitec-galaxus', 'digitec.ch galaxus.ch')
fam('ikea', 'ikea.com ikea.de ikea.fr ikea.it ikea.co.uk ikea.com.au')
# Same name, different operator: their own families.
SEPARATE = set('target.com.au kmart.com.au woolworths.com.au woolworths.co.za jumbo.ch jumbo.cl jumbo.com coop.ch coop.se coop.it '
               'sears.com.mx officedepot.com.mx extra.com toysrus.co.jp toysrus.ca carrefouruae.com loft.co.jp'.split())

MULTI_SUFFIX = re.compile(r'\.(co|com|ne|or|net)\.[a-z]{2}$')
def family_of(domain):
    if domain in SEPARATE: return domain
    if domain in FAMILY: return FAMILY[domain]
    base = MULTI_SUFFIX.sub('', domain)
    base = re.sub(r'\.[a-z]+$', '', base)
    return base.split('.')[-1]

v1 = json.load(open(os.path.join(ROOT, 'evals/merchants/retail-frame.json')))
v1_domains = {d['domain'] for d in v1['domains']}
entries = []
for d in v1['domains']:
    e = dict(d)
    e['region'], e['currency'] = 'US', 'USD'
    if d['exclusion'] == 'non-us-online-retailer':
        e['eligible'], e['exclusion'] = (True, None) if d['domain'] in V1_LIFTED_US else (False, 'multi-market-domain')
        if not e['eligible']: e['region'], e['currency'] = None, None
    entries.append(e)

seen = set(v1_domains)
for fname in ('retailers-a.txt', 'retailers-b.txt'):
    for line in open(os.path.join(ROOT, 'evals/merchants/frame-2-inputs', fname)):
        parts = line.split()
        if len(parts) != 3 or line.startswith('#'): continue
        dom, region, cur = parts
        if dom != dom.lower() or dom in seen: continue
        seen.add(dom)
        if dom in US_STOREFRONT: region, cur = 'US', 'USD'
        b = band(ranks.get(dom))
        code = EXCLUDE.get(dom)
        if b is None: code = 'outside-top-100k'
        if code == 'multi-market-domain': region, cur = None, None
        entries.append({'domain': dom, 'band': b or ('beyond-100k' if dom in ranks else 'unranked'),
                        'eligible': code is None, 'exclusion': code, 'probeSite': False, 'region': region, 'currency': cur})

# One storefront per retailer family: a retail-frame.1 member keeps the family; otherwise the eligible member with the
# lowest SHA-256("<seed>|retailer-family|<domain>"). Every other member is excluded as same-retailer-other-domain.
families = {}
for e in entries:
    families.setdefault(family_of(e['domain']), []).append(e)
for name, members in families.items():
    if len(members) < 2: continue
    in_v1 = [m for m in members if m['domain'] in v1_domains]
    if in_v1:
        keep = in_v1
    else:
        ok = sorted([m for m in members if m['eligible']], key=lambda m: key('retailer-family', m['domain']))
        keep = ok[:1]
    for m in members:
        if m not in keep and m['domain'] not in v1_domains and m['eligible']:
            m['eligible'], m['exclusion'] = False, 'same-retailer-other-domain'

for e in entries:
    e['family'] = family_of(e['domain'])
    e['regionGroup'] = GROUP.get(e['region']) if e['region'] else None

order = {'top-1k': 0, '1k-10k': 1, '10k-100k': 2, 'beyond-100k': 3, 'unranked': 4}
entries.sort(key=lambda e: (order[e['band']], e['domain']))
from collections import Counter
counts = {'eligible': {}, 'excluded': {}}
for e in entries:
    if e['eligible']:
        g = 'us' if e['regionGroup'] == 'us' else 'non-us'
        counts['eligible'].setdefault(e['band'], {}).setdefault(g, 0)
        counts['eligible'][e['band']][g] += 1
    else:
        counts['excluded'][e['exclusion']] = counts['excluded'].get(e['exclusion'], 0) + 1
counts['excluded'] = dict(sorted(counts['excluded'].items()))
counts['eligibleByRegionGroup'] = dict(sorted(Counter(e['regionGroup'] for e in entries if e['eligible']).items()))
counts['eligibleByCurrency'] = dict(sorted(Counter(e['currency'] for e in entries if e['eligible']).items()))

frame = {
    'frame': 'retail-frame.2',
    'frozenOn': '2026-10-05',
    'source': v1['source'].replace('evals/merchants/data/frame-ranks.json', 'evals/merchants/data/frame2/frame-2-ranks.json; inputs evals/merchants/frame-2-inputs/, build script evals/merchants/tools/build-retail-frame-2.py'),
    'classification': ('Agent-classified online retail of physical goods worldwide (claude-code/claude-opus-5-5, 2026-10-05), no '
                       'website visited: every retail-frame.1 domain with its classification (the U.S.-only rule lifted), plus the '
                       "agent's lists of retailers in 58 countries besides the U.S. and a read of the ccTLD domains in Tranco ranks 1-10,000, looked up "
                       'in Tranco. region / currency: the storefront a visitor in the United States gets at the domain without '
                       'choosing a country. Rules and exclusion codes: docs/evals/generic-reader-protocol.md#retail-frame'),
    'supersedes': 'retail-frame.1 for the reader evaluation; retail-frame.1 stays frozen for the merchant-pipeline held-out list',
    'bands': v1['bands'],
    'regionGroups': {
        'us': 'US',
        'canada-latam': 'CA MX BR AR CL CO PE',
        'europe': 'GB IE DE FR ES PT IT NL BE AT CH PL CZ SK RO HU BG GR SE DK NO FI TR UA (RU BY excluded)',
        'asia-pacific': 'JP KR CN HK TW SG MY ID TH PH VN IN PK BD LK AU NZ KZ',
        'middle-east-africa': 'AE SA IL EG ZA NG KE',
    },
    'counts': counts,
    'domains': [{k: e[k] for k in ('domain', 'band', 'eligible', 'exclusion', 'probeSite', 'region', 'currency', 'regionGroup', 'family')}
                for e in entries],
}
out = os.path.join(ROOT, 'evals/merchants/retail-frame-2.json')
open(out, 'w').write(json.dumps(frame, indent=1, ensure_ascii=False) + '\n')
os.makedirs(os.path.join(DATA, 'frame2'), exist_ok=True)
json.dump({e['domain']: ranks.get(e['domain']) for e in entries}, open(os.path.join(DATA, 'frame2', 'frame-2-ranks.json'), 'w'), indent=1)
print(json.dumps(counts, indent=1))
print(len(entries), hashlib.sha256(open(out, 'rb').read()).hexdigest())
