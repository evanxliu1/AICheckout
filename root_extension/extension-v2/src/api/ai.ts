// AI/LLM API client
// Handles communication with OpenAI (or other LLM providers)

import type {
  CreditCard,
  CartItem,
  Recommendation,
  OpenAIRequest,
  OpenAIResponse,
} from '../types';

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
  "card": "<Card Name>",
  "rewards": {"<category>": "<reward>", ...},
  "merchant": "<website URL>",
  "category": "<merchant category>",
  "reasoning": "<Step-by-step explanation of why this card was chosen, including: (1) what categories matched, (2) reward comparison between cards, (3) why this card has the best value>"
}`;
}

/**
 * Call OpenAI API
 */
export async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const requestBody: OpenAIRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that recommends credit cards.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 300,
    temperature: 0.7
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'OpenAI API error');
  }

  const data: OpenAIResponse = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Parse LLM response into Recommendation object
 */
export function parseRecommendation(llmResponse: string): Recommendation {
  try {
    // Remove markdown code blocks if present
    let jsonStr = llmResponse.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.card || !parsed.rewards || !parsed.merchant || !parsed.category) {
      throw new Error('Missing required fields in recommendation');
    }

    return {
      card: parsed.card,
      rewards: parsed.rewards,
      merchant: parsed.merchant,
      category: parsed.category,
      reasoning: parsed.reasoning || 'No reasoning provided',
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error parsing recommendation:', error);
    console.error('Raw response:', llmResponse);
    throw new Error('Failed to parse recommendation from LLM response');
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
  const prompt = buildPrompt(cartItems, site, cards);
  const rawResponse = await callOpenAI(prompt, apiKey);
  const recommendation = parseRecommendation(rawResponse);

  return { recommendation, prompt, rawResponse };
}
