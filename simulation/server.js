require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { buildLLMPrompt, callOpenAIChat } = require('./llm');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const cards = JSON.parse(fs.readFileSync('./cards.json', 'utf8'));

const CATEGORY_ITEMS = {
  groceries: ['apple', 'milk', 'bread', 'eggs', 'banana', 'chicken', 'rice', 'cheese'],
  dining: ['burger', 'pizza', 'sushi', 'pasta', 'salad', 'steak', 'sandwich'],
  travel: ['flight ticket', 'hotel night', 'car rental', 'train ticket'],
  entertainment: ['movie ticket', 'concert', 'museum', 'theme park'],
  online: ['headphones', 'USB cable', 'laptop stand', 'mouse', 'keyboard'],
  beauty: ['shampoo', 'conditioner', 'face mask', 'lotion', 'perfume']
};
const CATEGORIES = Object.keys(CATEGORY_ITEMS);

function getRandomCart() {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const items = [];
  const numItems = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < numItems; ++i) {
    items.push(CATEGORY_ITEMS[category][Math.floor(Math.random() * CATEGORY_ITEMS[category].length)]);
  }
  const amount = +(Math.random() * 90 + 10).toFixed(2); // $10 - $100
  return { cart: items, amount, site: `${category}.com` };
}

function parseRewardString(str) {
  if (!str) return 0;
  if (str.includes('%')) {
    const match = str.match(/([\d.]+)%/);
    return match ? parseFloat(match[1]) / 100 : 0;
  }
  if (str.includes('x point')) {
    const match = str.match(/([\d.]+)x/);
    return match ? parseFloat(match[1]) * 0.01 : 0;
  }
  return 0;
}

app.post('/simulate', async (req, res) => {
  const n = Math.max(1, Math.min(500, parseInt(req.body.numCarts, 10) || 100));
  const results = [];
  let totalSpent = 0, totalAIRewards = 0, totalFlatRewards = 0;

  for (let i = 0; i < n; ++i) {
    const { cart, amount, site } = getRandomCart();
    totalSpent += amount;

    const prompt = buildLLMPrompt(cart, site, cards);
    let llmResp;
    try {
      const llmRaw = await callOpenAIChat(prompt);
      console.log(`LLM raw response for cart [${cart.join(', ')}]:\n${llmRaw}\n`);
      let jsonStr = llmRaw.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
      }
      llmResp = JSON.parse(jsonStr);
    } catch (e) {
      llmResp = { card: null, rewards: { all: "1% cashback" }, category: "all" };
    }

    const cardObj = cards.find(c => c.name === llmResp.card) || null;
    let rewardStr = "1% cashback";
    if (cardObj && llmResp.category && cardObj.rewards[llmResp.category]) {
      rewardStr = cardObj.rewards[llmResp.category];
    } else if (cardObj && cardObj.rewards['all']) {
      rewardStr = cardObj.rewards['all'];
    }
    const aiReward = amount * parseRewardString(rewardStr);
    const flatReward = amount * 0.01;

    totalAIRewards += aiReward;
    totalFlatRewards += flatReward;

    results.push({
      cart,
      amount,
      recommendedCard: llmResp.card,
      inferredCategory: llmResp.category,
      aiReward: aiReward,
      flatReward: flatReward,
      rewardStr
    });
  }

  res.json({
    totalSpent: totalSpent.toFixed(2),
    totalAIRewards: totalAIRewards.toFixed(2),
    totalFlatRewards: totalFlatRewards.toFixed(2),
    multiplier: (totalAIRewards / totalFlatRewards).toFixed(2),
    results
  });
});

app.listen(PORT, () => {
  console.log(`Simulation server running at http://localhost:${PORT}`);
});
