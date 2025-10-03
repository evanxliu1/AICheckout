import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client with service role key (for server-side operations)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all active credit cards
app.get('/api/cards', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching cards:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch credit cards'
    });
  }
});

// Get single card by ID
app.get('/api/cards/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error fetching card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch credit card'
    });
  }
});

// Get recommendation (calls OpenAI)
app.post('/api/recommend', async (req, res) => {
  try {
    const { cartItems, site, openaiKey } = req.body;

    // Validate request
    if (!openaiKey) {
      return res.status(400).json({
        success: false,
        error: 'OpenAI API key is required'
      });
    }

    if (!Array.isArray(cartItems)) {
      return res.status(400).json({
        success: false,
        error: 'cartItems must be an array'
      });
    }

    if (!site) {
      return res.status(400).json({
        success: false,
        error: 'site is required'
      });
    }

    // Fetch active cards from Supabase
    const { data: cards, error: cardsError } = await supabase
      .from('credit_cards')
      .select('*')
      .eq('is_active', true);

    if (cardsError) {
      throw cardsError;
    }

    // Build prompt for OpenAI
    const cardInfo = cards.map(card => {
      const rewardCategories = Object.entries(card.rewards)
        .map(([cat, val]) => `${cat}: ${val}`)
        .join(', ');
      return `Name: ${card.name}\nReward Categories: ${rewardCategories}\nAnnual Fee: $${card.annual_fee}\nDescription: ${card.description}`;
    }).join('\n---\n');

    const cartText = cartItems.length > 0
      ? cartItems.map((item, i) => `${i + 1}. ${typeof item === 'string' ? item : item.name}`).join('\n')
      : '[Cart items could not be extracted]';

    const prompt = `You are a helpful assistant that recommends credit cards.\n\nHere are the items in the user's shopping cart:\n${cartText}\n\nThe website is: ${site}\n\nHere are the available credit cards (with their reward categories):\n${cardInfo}\n\nFirst, infer the most likely merchant category for this purchase based on the cart and website.\nThen, recommend the single best card for this purchase.\n\nRespond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:\n{\n  "card": <Card Name>,\n  "rewards": {<category>: <reward>, ...},\n  "merchant": <website URL>,\n  "category": <merchant category>\n}`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that recommends credit cards.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 120
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json();
      throw new Error(errorData.error?.message || 'OpenAI API error');
    }

    const openaiData = await openaiResponse.json();
    const llmResponse = openaiData.choices[0].message.content.trim();

    // Parse JSON response (remove markdown code blocks if present)
    let jsonStr = llmResponse;
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const recommendation = JSON.parse(jsonStr);

    res.json({
      success: true,
      data: recommendation
    });
  } catch (error) {
    console.error('Error generating recommendation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate recommendation'
    });
  }
});

// Create new card (admin only - requires service role)
app.post('/api/cards', async (req, res) => {
  try {
    const { name, annual_fee, rewards, description } = req.body;

    // Validate required fields
    if (!name || annual_fee === undefined || !rewards) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, annual_fee, rewards'
      });
    }

    const { data, error } = await supabase
      .from('credit_cards')
      .insert([{
        name,
        annual_fee,
        rewards,
        description,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create credit card'
    });
  }
});

// Update card (admin only)
app.put('/api/cards/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, annual_fee, rewards, description, is_active } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (annual_fee !== undefined) updateData.annual_fee = annual_fee;
    if (rewards !== undefined) updateData.rewards = rewards;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('credit_cards')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error updating card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update credit card'
    });
  }
});

// Delete card (soft delete by setting is_active to false)
app.delete('/api/cards/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('credit_cards')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data,
      message: 'Card deactivated successfully'
    });
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete credit card'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Credit Card API server running on http://localhost:${PORT}`);
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log('\nAvailable endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /api/cards');
  console.log('  GET  /api/cards/:id');
  console.log('  POST /api/recommend');
  console.log('  POST /api/cards (admin)');
  console.log('  PUT  /api/cards/:id (admin)');
  console.log('  DELETE /api/cards/:id (admin)');
});
