const fs = require('fs');
const { OpenAI } = require("openai");
const credentials = JSON.parse(fs.readFileSync(__dirname + '/credentials.json', 'utf8'));
const openai = new OpenAI({ apiKey: credentials.OPENAI_API_KEY });

function buildLLMPrompt(cartItems, site, cards) {
  const cardInfo = cards.map(card =>
    `Name: ${card.name}\nReward Categories: ${Object.entries(card.rewards).map(([cat, val]) => `${cat}: ${val}`).join(', ')}\nAnnual Fee: $${card.annualFee}\nDescription: ${card.description}`
  ).join('\n---\n');
  const cartText = cartItems.length > 0
    ? cartItems.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : '[Cart items could not be extracted]';
  return `You are a helpful assistant that recommends credit cards.\n\nHere are the items in the user's shopping cart:\n${cartText}\n\nThe website is: ${site}\n\nHere are the available credit cards (with their reward categories):\n${cardInfo}\n\nFirst, infer the most likely merchant category for this purchase based on the cart and website.\nThen, recommend the single best card for this purchase.\n\nRespond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:\n{\n  "card": <Card Name>,\n  "rewards": {<category>: <reward>, ...},\n  "merchant": <website URL>,\n  "category": <merchant category>\n}`;
}

async function callOpenAIChat(prompt) {
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "You are a helpful assistant that recommends credit cards." },
      { role: "user", content: prompt }
    ],
    max_tokens: 120
  });
  return completion.choices[0].message.content.trim();
}

module.exports = { buildLLMPrompt, callOpenAIChat };
