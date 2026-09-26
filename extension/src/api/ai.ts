// AI/LLM API client
// Handles communication with OpenAI (or other LLM providers)

import type {
  CreditCard,
  CartItem,
  Recommendation,
  OpenAIRequest,
} from '../types';
import { z } from 'zod';
import { cartItemsSchema, creditCardsSchema, recommendationSchema } from '../types/schemas';

/**
 * Build LLM prompt for recommendation
 */
export function buildPrompt(cartItems: CartItem[], site: string, cards: CreditCard[]): string {
  const cardInfo = cards
    .map((card) => {
      const rewardCategories = Object.entries(card.rewards)
        .map(([cat, val]) => `${cat}: ${val}`)
        .join(', ');
      return `Name: ${card.name}\nReward Categories: ${rewardCategories}\nAnnual Fee: $${card.annualFee}\nDescription: ${card.description}`;
    })
    .join('\n---\n');

  const cartText =
    cartItems.length > 0
      ? cartItems
          .map((item, i) => {
            const itemName = typeof item === 'string' ? item : item.name;
            return `${i + 1}. ${itemName}`;
          })
          .join('\n')
      : '[Cart items could not be extracted]';

  return `You are a helpful assistant that recommends credit cards.

Here are the items in the user's shopping cart:
${cartText}

The website is: ${site}

Here are the available credit cards (with their reward categories):
${cardInfo}

IMPORTANT INSTRUCTIONS:
1. First, determine the merchant category for this purchase:
   - If this is an e-commerce website (like Amazon, Sephora, Target.com, etc.), consider the "online" category
   - Also consider specific categories like groceries, dining, entertainment, travel, streaming, etc.
   - A purchase can match MULTIPLE categories (e.g., Sephora.com is both "online" and "beauty/retail")

2. For each card, calculate the ACTUAL reward value:
   - "5% cashback" = 5% return
   - "4x points" ≈ 4% return (assume 1 point = 1 cent for comparison)
   - "3% cashback" = 3% return
   - Compare the HIGHEST matching category for each card

3. Recommend the card with the HIGHEST reward rate for the matching categories

4. Explain your reasoning step-by-step

Respond ONLY with a valid JSON object with the following fields and no other text, no markdown:
{
  "card": "<Recommended Card Name>",
  "rewards": {"<matching category>": "<reward rate for THIS card only>"},
  "merchant": "<website URL>",
  "category": "<merchant category>",
  "reasoning": "<Brief explanation: what category matched and why this card wins>"
}

IMPORTANT: The "rewards" field should ONLY contain the matching reward categories for the RECOMMENDED card, NOT all cards.`;
}

/**
 * Call OpenAI API
 */
export async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const requestBody: OpenAIRequest = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that recommends credit cards.' },
      { role: 'user', content: prompt }
    ],
    max_completion_tokens: 500,
    temperature: 0.7
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('The API key was rejected. Update it in Settings.');
    if (response.status === 429) throw new Error('The AI service is at its usage limit. Check your API quota or try later.');
    throw new Error('The AI service is unavailable. Please try again.');
  }

  const data = z.object({ choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
    finish_reason: z.string(),
  })).min(1) }).parse(await response.json());
  const choice = data.choices[0];
  if (choice.finish_reason !== 'stop' || !choice.message.content) {
    throw new Error('The AI service did not return a complete result. Please try again.');
  }
  const content = choice.message.content;
  return content.trim();
}

/**
 * Parse LLM response into Recommendation object
 */
export function parseRecommendation(
  llmResponse: string,
  context?: { cards: CreditCard[]; site: string },
): Recommendation {
  if (llmResponse.length > 20_000) throw new Error('The recommendation was too large.');
  try {
    const json = llmResponse.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = recommendationSchema.parse(JSON.parse(json));
    if (context) {
      const card = context.cards.find((candidate) => candidate.name === parsed.card);
      if (!card || parsed.merchant !== context.site) throw new Error('Unexpected card or merchant');
      for (const [category, rate] of Object.entries(parsed.rewards)) {
        if (card.rewards[category] !== rate) throw new Error('Unverified reward rate');
      }
    }
    return { ...parsed, reasoning: parsed.reasoning ?? 'No explanation available.', timestamp: Date.now() };
  } catch {
    throw new Error('The AI result could not be verified against the card catalog. Please try again.');
  }
}

/**
 * Get recommendation from AI
 * Combines prompt building, API call, and response parsing
 */
export async function getAIRecommendation(
  cartItems: CartItem[],
  site: string,
  cards: CreditCard[],
  apiKey: string
): Promise<{ recommendation: Recommendation; prompt: string; rawResponse: string }> {
  cartItemsSchema.parse(cartItems);
  creditCardsSchema.nonempty().parse(cards);
  const prompt = buildPrompt(cartItems, site, cards);
  const rawResponse = await callOpenAI(prompt, apiKey);
  const recommendation = parseRecommendation(rawResponse, { cards, site });

  return { recommendation, prompt, rawResponse };
}
