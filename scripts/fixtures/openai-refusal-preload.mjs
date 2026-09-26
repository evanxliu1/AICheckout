import assert from 'node:assert/strict';

// Test-process-only transport. Never used by the production entrypoint.
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:54321');
assert.equal(process.env.OPENAI_API_KEY, 'sk-SYNTHETIC-HTTP-TEST');
const localFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === 'https://api.openai.com/v1/responses') {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, 'gpt-synthetic-2026-09-25');
    assert.equal(request.store, false); assert.equal(request.stream, false);
    assert.deepEqual(request.tools, []); assert.equal(request.text.format.strict, true);
    let content = [{ type: 'refusal', refusal: 'Synthetic intercepted SDK response. No provider request or actual billing occurred.' }];
    if (process.env.CURATION_TEST_OUTPUT === 'extraction') {
      const input = JSON.parse(request.input[0].content), doc = input.documents[0];
      assert.equal(input.target.cardId, 'capital-one-quicksilver');
      assert.ok(doc.body.startsWith('SYNTHETIC REVIEW TEST:'));
      const cite = quote => { const start = doc.body.indexOf(quote); assert.ok(start >= 0); return [{ documentId: doc.documentId,
        contentHash: doc.contentHash, quote, start, end: start + quote.length }]; };
      const output = { schemaVersion: 1, cardId: input.target.cardId, rules: [{ ruleId: 'quicksilver-base',
        rateBps: { state: 'known', value: 250, evidence: cite('Earn 2.5% on all eligible purchases.') },
        category: { state: 'known', value: 'all-eligible', evidence: cite('all eligible purchases') },
        activation: { state: 'known', value: false, evidence: cite('No activation is required.') },
        cap: { state: 'known', kind: 'none', amountCents: null, period: null, evidence: cite('There is no annual spending cap.') },
      }], conditions: [{ kind: 'eligibility', text: 'Only eligible purchases earn this synthetic reward.', evidence: cite('all eligible purchases') }], issues: [] };
      content = [{ type: 'output_text', text: JSON.stringify(output) }];
    }
    return Response.json({ id: 'resp_synthetic_http', model: request.model, status: 'completed', error: null, incomplete_details: null,
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      output: [{ type: 'message', role: 'assistant', status: 'completed', content }],
    });
  }
  assert.equal(url.origin, 'http://127.0.0.1:54321', 'The SDK test must not make external requests');
  return localFetch(input, init);
};
