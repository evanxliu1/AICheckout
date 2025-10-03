import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase Connection...\n');
console.log('Supabase URL:', supabaseUrl);
console.log('Anon Key:', supabaseKey ? '✓ Present' : '✗ Missing');
console.log('');

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    console.log('1. Testing database connection...');

    // Test if credit_cards table exists and fetch data
    const { data, error, count } = await supabase
      .from('credit_cards')
      .select('*', { count: 'exact' });

    if (error) {
      console.error('❌ Database error:', error.message);
      console.error('');
      console.log('Possible issues:');
      console.log('  - Table "credit_cards" does not exist yet');
      console.log('  - Migration SQL has not been run');
      console.log('  - RLS policies are blocking access');
      console.log('');
      console.log('To fix:');
      console.log('  1. Go to https://supabase.com/dashboard/project/rnzzyeuzydyrdjuihomb');
      console.log('  2. Click "SQL Editor" in sidebar');
      console.log('  3. Run: supabase/migrations/001_create_credit_cards_table.sql');
      console.log('  4. Run: supabase/seed/001_seed_credit_cards.sql');
      return;
    }

    console.log('✓ Database connection successful!');
    console.log('');

    console.log('2. Checking credit_cards table...');
    console.log(`✓ Found ${count} credit cards in database`);
    console.log('');

    if (count === 0) {
      console.log('⚠️  No cards found. Please run the seed SQL:');
      console.log('   supabase/seed/001_seed_credit_cards.sql');
      console.log('');
      return;
    }

    console.log('3. Credit Cards Data:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    data.forEach((card, index) => {
      console.log(`\n${index + 1}. ${card.name}`);
      console.log(`   Annual Fee: $${card.annual_fee}`);
      console.log(`   Active: ${card.is_active ? '✓' : '✗'}`);
      console.log(`   Rewards:`, JSON.stringify(card.rewards, null, 2).replace(/\n/g, '\n   '));
      console.log(`   Description: ${card.description}`);
      console.log(`   Created: ${new Date(card.created_at).toLocaleDateString()}`);
    });
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    console.log('✅ Supabase setup is complete and working!');
    console.log('');
    console.log('Next steps:');
    console.log('  - Proceed with Phase 3: Extension Core implementation');
    console.log('  - Or test the API server: cd api && npm install && npm run dev');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.error(error);
  }
}

testConnection();
