import { describe, expect, it, vi, afterEach } from 'vitest';
import { callOpenAI, parseRecommendation } from '../src/api/ai';
import type { CreditCard } from '../src/types';

const card: CreditCard = { id: 'test-card', name: 'Test Card', annualFee: 0, rewards: { general: '1% cashback' }, description: '' };
const valid = { card: card.name, rewards: card.rewards, merchant: 'shop.example', category: 'general', reasoning: 'Base rate applies.' };
const context = { cards: [card], site: valid.merchant };

afterEach(() => vi.unstubAllGlobals());

describe('model output boundary', () => {
  it('accepts a result backed by the supplied catalog', () => {
    expect(parseRecommendation(JSON.stringify(valid), context).card).toBe(card.name);
  });
  it.each([
    { ...valid, card: { name: card.name } },
    { ...valid, card: 'Invented Card' },
    { ...valid, rewards: { general: '100% cashback' } },
    { ...valid, rewards: {} },
    { ...valid, merchant: 'different.example' },
    { ...valid, rewards: { general: 100 } },
    null,
  ])('rejects invalid or ungrounded results: %j', (result) => {
    expect(() => parseRecommendation(JSON.stringify(result), context)).toThrow();
  });
  it('rejects unbounded output', () => {
    expect(() => parseRecommendation('x'.repeat(20_001), context)).toThrow('too large');
  });
  it('rejects a truncated response even if it contains valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [
      { message: { content: JSON.stringify(valid) }, finish_reason: 'length' },
    ] }))));
    await expect(callOpenAI('test', 'test-key')).rejects.toThrow('complete result');
  });
  it('uses a timeout and returns safe quota errors without provider response contents', async () => {
    const request = vi.fn().mockResolvedValue(new Response('private-provider-details', { status: 429 }));
    vi.stubGlobal('fetch', request);
    await expect(callOpenAI('test', 'test-key')).rejects.toThrow('usage limit');
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
