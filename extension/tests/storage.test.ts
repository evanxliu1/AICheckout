import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areCachedCardsStale, exportSettings, getCachedCards, importSettings, setCachedCards, setOpenAIKey } from '../src/utils/storage';
import { logRecommendation } from '../src/utils/logging';

let data: Record<string, unknown>;
const write = vi.fn();
beforeEach(() => {
  data = {};
  write.mockReset().mockImplementation(async (value) => { Object.assign(data, value); });
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => data), set: write, remove: vi.fn(async (key: string) => { delete data[key]; }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

const cards = [{ name: 'Test card', annualFee: 0, rewards: { general: '1%' }, description: '' }];
describe('storage boundaries', () => {
  it('propagates storage write errors instead of reporting success', async () => {
    write.mockRejectedValue(new Error('quota exceeded'));
    await expect(setOpenAIKey('test-key')).rejects.toThrow('quota exceeded');
  });
  it('writes catalog and freshness metadata atomically', async () => {
    await setCachedCards(cards);
    expect(write).toHaveBeenCalledTimes(1);
    expect(data.cachedCards).toEqual(cards);
    expect(await areCachedCardsStale()).toBe(false);
  });
  it('treats malformed and future cache timestamps as stale', async () => {
    data.lastCardsFetch = Date.now() + 60_000;
    expect(await areCachedCardsStale()).toBe(true);
    data.lastCardsFetch = 'yesterday';
    expect(await areCachedCardsStale()).toBe(true);
  });
  it('rejects corrupted cached cards', async () => {
    data.cachedCards = [{ ...cards[0], rewards: 100 }];
    expect(await getCachedCards()).toEqual([]);
  });
  it('does not export keys or raw diagnostic data', async () => {
    data = { openaiKey: 'secret', debugMode: true, recommendationLogs: [{ prompt: 'private cart' }] };
    expect(JSON.parse(await exportSettings())).toEqual({ debugMode: true });
  });
  it('imports only the explicitly allowed preference', async () => {
    await importSettings(JSON.stringify({ debugMode: true, openaiKey: 'attacker-key', cachedCards: cards }));
    expect(data).toEqual({ debugMode: true });
  });
  it('does not store shopping diagnostics by default', async () => {
    await logRecommendation({ timestamp: Date.now(), site: 'shop.example', cartItems: [{ name: 'private item' }],
      recommendation: { card: 'Test card', rewards: { general: '1%' }, category: 'general', merchant: 'shop.example' },
      allCards: [], prompt: 'private prompt', rawResponse: 'private response' });
    expect(write).not.toHaveBeenCalled();
  });
});
