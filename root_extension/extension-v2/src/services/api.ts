// API service layer for Credit Card Recommender extension
// Handles communication with backend API or direct API calls

import type {
  CreditCard,
  CartItem,
  Recommendation,
  RecommendationRequest,
  APIResponse,
  OpenAIRequest,
  OpenAIResponse
} from '../types';
import { getActiveCards } from './supabase';
import { getOpenAIKey } from '../utils/storage';

/**
 * Configuration for API endpoints
 * Set USE_BACKEND_API to true if using the Node.js API server
 */
const USE_BACKEND_API = false; // Toggle this to switch between direct calls and backend API
const BACKEND_API_URL = 'http://localhost:3000'; // Update for production deployment

/**
 * Card API Client
 */
export class CardAPIClient {
  /**
   * Get all active credit cards
   * Uses either backend API or direct Supabase access
   */
  async getCards(): Promise<CreditCard[]> {
    try {
      if (USE_BACKEND_API) {
        // Use backend API
        const response = await fetch(`${BACKEND_API_URL}/api/cards`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result: APIResponse<CreditCard[]> = await response.json();
        if (!result.success || !result.data) {
          throw new Error(result.error || 'Failed to fetch cards');
        }
        return result.data;
      } else {
        // Direct Supabase access
        return await getActiveCards();
      }
    } catch (error) {
      console.error('Error fetching cards:', error);
      throw error;
    }
  }

  /**
   * Get recommendation for cart items
   * Calls OpenAI API to generate recommendation
   */
  async getRecommendation(
    cartItems: CartItem[],
    site: string,
    apiKey?: string
  ): Promise<Recommendation> {
    try {
      // Get API key from storage if not provided
      const openaiKey = apiKey || (await getOpenAIKey());
      if (!openaiKey) {
        throw new Error('OpenAI API key not configured');
      }

      if (USE_BACKEND_API) {
        // Use backend API
        return await this.getRecommendationFromBackend(cartItems, site, openaiKey);
      } else {
        // Direct OpenAI API call
        return await this.getRecommendationDirect(cartItems, site, openaiKey);
      }
    } catch (error) {
      console.error('Error getting recommendation:', error);
      throw error;
    }
  }

  /**
   * Get recommendation via backend API server
   */
  private async getRecommendationFromBackend(
    cartItems: CartItem[],
    site: string,
    openaiKey: string
  ): Promise<Recommendation> {
    const response = await fetch(`${BACKEND_API_URL}/api/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cartItems,
        site,
        openaiKey
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: APIResponse<Recommendation> = await response.json();
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to get recommendation');
    }

    return result.data;
  }

  /**
   * Get recommendation via direct OpenAI API call
   */
  private async getRecommendationDirect(
    cartItems: CartItem[],
    site: string,
    openaiKey: string
  ): Promise<Recommendation> {
    // Get active cards
    const cards = await this.getCards();

    // Build prompt
    const prompt = this.buildPrompt(cartItems, site, cards);

    // Call OpenAI
    const llmResponse = await this.callOpenAI(prompt, openaiKey);

    // Parse response
    return this.parseRecommendation(llmResponse);
  }

  /**
   * Build LLM prompt for recommendation
   */
  private buildPrompt(cartItems: CartItem[], site: string, cards: CreditCard[]): string {
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

First, infer the most likely merchant category for this purchase based on the cart and website.
Then, recommend the single best card for this purchase.

Respond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:
{
  "card": <Card Name>,
  "rewards": {<category>: <reward>, ...},
  "merchant": <website URL>,
  "category": <merchant category>
}`;
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string, apiKey: string): Promise<string> {
    const requestBody: OpenAIRequest = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that recommends credit cards.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 120,
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
  private parseRecommendation(llmResponse: string): Recommendation {
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
        category: parsed.category
      };
    } catch (error) {
      console.error('Error parsing recommendation:', error);
      console.error('Raw response:', llmResponse);
      throw new Error('Failed to parse recommendation from LLM response');
    }
  }
}

/**
 * Create singleton instance
 */
export const cardAPI = new CardAPIClient();

/**
 * Retry logic wrapper
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  }

  throw lastError || new Error('Max retries reached');
}
