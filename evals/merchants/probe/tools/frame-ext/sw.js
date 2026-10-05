// Prototype (Phase 10 probe, not shipped). Q6 desk check helper: write and read a 2 MiB JSON value.
self.probeStorage = async () => {
  const rows = [];
  let i = 0;
  let json = '';
  while (json.length < 2 * 1024 * 1024 - 400) {
    rows.push({
      hosts: ['merchant-' + i + '.example'],
      name: 'Merchant ' + i,
      hostKind: 'merchant',
      plausibleCategories: [{ category: 'general-merchandise', evidenceClass: 4 }],
      brandIds: [],
    });
    i += 1;
    if (i % 200 === 0) json = JSON.stringify({ rows });
  }
  json = JSON.stringify({ rows });
  const t0 = performance.now();
  await chrome.storage.local.set({ merchantDb: json });
  const t1 = performance.now();
  const got = await chrome.storage.local.get('merchantDb');
  const t2 = performance.now();
  const parsed = JSON.parse(got.merchantDb);
  const t3 = performance.now();
  const bytes = await chrome.storage.local.getBytesInUse('merchantDb');
  await chrome.storage.local.remove('merchantDb');
  return {
    rows: parsed.rows.length,
    jsonChars: json.length,
    bytesInUse: bytes,
    quotaBytes: chrome.storage.local.QUOTA_BYTES,
    setMs: Math.round(t1 - t0),
    getMs: Math.round(t2 - t1),
    parseMs: Math.round(t3 - t2),
  };
};
