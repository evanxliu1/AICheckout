import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

try {
  if (!url || !key) throw new Error('Set the public Supabase URL and key in extension/.env.');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  const { data, error } = await client.from('credit_cards').select('id').eq('is_active', true);
  if (error) throw new Error(`Catalog read failed: ${error.message}`);
  if (!data?.length) throw new Error('No active cards are readable with the public client key.');
  console.log(`Catalog connection passed: ${data.length} active cards are publicly readable.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Catalog connection failed.');
  process.exitCode = 1;
}
