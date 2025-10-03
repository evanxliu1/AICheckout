// Supabase client for Credit Card Recommender extension
// Handles database operations for credit cards

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CreditCard } from '../types';
import { getCachedCards, setCachedCards, areCachedCardsStale } from '../utils/storage';

// Get Supabase credentials from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials. Check your .env file.');
}

// Initialize Supabase client (singleton)
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase credentials not configured');
    }
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseClient;
}

/**
 * Fetch all active credit cards from Supabase
 * Uses caching to reduce API calls
 */
export async function getActiveCards(forceRefresh = false): Promise<CreditCard[]> {
  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const isStale = await areCachedCardsStale();
      if (!isStale) {
        const cachedCards = await getCachedCards();
        if (cachedCards.length > 0) {
          console.log('Using cached cards:', cachedCards.length);
          return cachedCards;
        }
      }
    }

    // Fetch from Supabase
    console.log('Fetching cards from Supabase...');
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('No active cards found in database');
    }

    // Transform data to match CreditCard interface
    const cards: CreditCard[] = data.map((card: any) => ({
      id: card.id,
      name: card.name,
      annualFee: Number(card.annual_fee),
      rewards: card.rewards,
      description: card.description || '',
      isActive: card.is_active,
      createdAt: card.created_at,
      updatedAt: card.updated_at
    }));

    // Cache the results
    await setCachedCards(cards);

    console.log('Fetched and cached cards:', cards.length);
    return cards;
  } catch (error) {
    console.error('Error fetching cards:', error);

    // Fallback to cached cards if available
    const cachedCards = await getCachedCards();
    if (cachedCards.length > 0) {
      console.log('Using cached cards as fallback');
      return cachedCards;
    }

    throw error;
  }
}

/**
 * Get a single card by ID
 */
export async function getCardById(id: string): Promise<CreditCard | null> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      name: data.name,
      annualFee: Number(data.annual_fee),
      rewards: data.rewards,
      description: data.description || '',
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('Error fetching card by ID:', error);
    return null;
  }
}

/**
 * Refresh card cache
 */
export async function refreshCardCache(): Promise<CreditCard[]> {
  return getActiveCards(true);
}

/**
 * Test Supabase connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('credit_cards').select('id').limit(1);
    return !error;
  } catch (error) {
    console.error('Supabase connection test failed:', error);
    return false;
  }
}
