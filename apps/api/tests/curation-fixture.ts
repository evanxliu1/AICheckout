import { vi } from 'vitest';
import { sha256, type ExtractionInput, type Extraction } from '../src/curation/extraction';
import type { ExtractionProvider } from '../src/curation/runner';

export function extractionFixture() {
  const body = 'Synthetic terms for a harness test. Earn 1.5% on all eligible purchases. There is no annual spending cap. No activation is required.';
  const document = { id: '30000000-0000-4000-8000-000000000001', source_key: 'capital-one-quicksilver-benefits',
    title: 'Synthetic test, not issuer evidence', url: 'https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/',
    checked_on: '2026-09-25', created_at: '2026-09-25T00:00:00Z', created_by: null, body, content_hash: sha256(body) };
  const cite = (quote: string) => [{ documentId: document.id, contentHash: document.content_hash, start: body.indexOf(quote), end: body.indexOf(quote) + quote.length, quote }];
  const input: ExtractionInput = { cardId: 'capital-one-quicksilver', documents: [document] };
  const output: Extraction = { schemaVersion: 1, cardId: input.cardId, rules: [{ ruleId: 'quicksilver-base',
    rateBps: { state: 'known', value: 150, evidence: cite('Earn 1.5% on all eligible purchases.') },
    category: { state: 'known', value: 'all-eligible', evidence: cite('all eligible purchases') },
    activation: { state: 'known', value: false, evidence: cite('No activation is required.') },
    cap: { state: 'known', kind: 'none', amountCents: null, period: null, evidence: cite('There is no annual spending cap.') },
  }], conditions: [{ kind: 'eligibility', text: 'Eligible purchases only.', evidence: cite('all eligible purchases') }], issues: [] };
  const reply = { finishReason: 'stop', text: JSON.stringify(output), usage: { inputTokens: 2000, outputTokens: 350 } };
  const invoke = vi.fn(async (): Promise<unknown> => reply);
  const provider: ExtractionProvider = { id: 'fixture', model: 'synthetic-v1', mode: 'fixture', pricing: { input: 0, output: 0 }, invoke };
  return { input, output, provider, invoke, reply };
}
