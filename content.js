// content.js
// Modular content script for cart extraction, LLM prompt building, and OpenAI API call

// --- Debug log interception (safe for multiple injections) ---
if (!window.__CC_LOG_PATCHED__) {
  window.__CC_LOG_PATCHED__ = true;
  window.ccDebugLogs = window.ccDebugLogs || [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;

  function logToPanel(type, ...args) {
    try {
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      window.ccDebugLogs.push(`[${type}] ${msg}`);
      if (window.ccDebugLogs.length > 100) window.ccDebugLogs.shift();
    } catch(e) {}
  }

  console.log = function(...args) { logToPanel('log', ...args); origLog.apply(console, args); };
  console.error = function(...args) { logToPanel('error', ...args); origErr.apply(console, args); };
  console.warn = function(...args) { logToPanel('warn', ...args); origWarn.apply(console, args); };
}
// --- End Debug log interception ---


  // Extracts cart items from the current page using common selectors
window.extractCartItems = function extractCartItems() {
    const selectors = [
      '[id*=cart], [class*=cart]',
      '[id*=basket], [class*=basket]',
      '[id*=checkout], [class*=checkout]',
      '[id*=bag], [class*=bag]'
    ];
    let items = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(container => {
        container.querySelectorAll('li, .cart-item, .product, .line-item').forEach(item => {
          const name = item.querySelector('.product-title, .item-title, .product-name, .name');
          if (name && name.textContent.trim().length > 0) {
            items.push(name.textContent.trim());
          }
        });
      });
    }
    // Fallback: find all visible product-like elements with prices
    if (items.length === 0) {
      document.querySelectorAll('li, .product, .cart-item, .line-item').forEach(item => {
        if (item.textContent.match(/\$\d/)) {
          items.push(item.textContent.trim());
        }
      });
    }
    // Deduplicate
    items = [...new Set(items)];
    return items;
  }

// Build LLM prompt string from cart, site, and cards
window.buildLLMPrompt = function buildLLMPrompt(cartItems, site, cards) {
  const cardInfo = cards.map(card => {
    return `Name: ${card.name}\nReward Categories: ${Object.entries(card.rewards).map(([cat, val]) => cat+': '+val).join(', ')}\nAnnual Fee: $${card.annualFee}\nDescription: ${card.description}`;
  }).join('\n---\n');
  const cartText = cartItems.length > 0
    ? cartItems.map((item, i) => `${i+1}. ${item}`).join('\n')
    : '[Cart items could not be extracted]';
  return `You are a helpful assistant that recommends credit cards.\n\nHere are the items in the user's shopping cart:\n${cartText}\n\nThe website is: ${site}\n\nHere are the available credit cards (with their reward categories):\n${cardInfo}\n\nFirst, infer the most likely merchant category for this purchase based on the cart and website.\nThen, recommend the single best card for this purchase.\n\nRespond ONLY with a valid JSON object with the following fields and no other text, no markdown, no explanation:\n{\n  \"card\": <Card Name>,\n  \"rewards\": {<category>: <reward>, ...},\n  \"merchant\": <website URL>,\n  \"category\": <merchant category>\n}`;
}

// Call OpenAI LLM
window.callOpenAIChat = async function callOpenAIChat(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
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
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error && err.error.message ? err.error.message : 'OpenAI API error');
  }
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

  // Utility: Get OpenAI API key from storage
  function getOpenAIApiKey(cb) {
    chrome.storage.local.get(['openaiKey'], result => {
      cb(result.openaiKey || '');
    });
  }

  // Utility: Call OpenAI LLM
  async function callOpenAIChat(prompt, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error && err.error.message ? err.error.message : 'OpenAI API error');
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  // Main flow
  function mainRecommendationFlow() {
    const host = window.location.hostname;
    getCachedCategory(host, function(cachedCategory) {
      let category = cachedCategory;
      if (!category) {
        category = inferCategory(host);
        setCachedCategory(host, category);
      }
      recommendCardForCategory(category);
    });
  }

  // Recommend card for category using RAG LLM only
  function recommendCardForCategory(category) {
    const cards = window.cards || [];
    // Compose LLM prompt with all card info and the merchant category
    const cardInfo = cards.map(card => {
      // Provide all relevant card fields to the LLM
      const rewardCategories = Object.entries(card.rewards)
        .map(([cat, val]) => `${cat}: ${val}`)
        .join(', ');
      return `Name: ${card.name}\nReward Categories: ${rewardCategories}\nAnnual Fee: $${card.annualFee}\nDescription: ${card.description}`;
    }).join('\n---\n');

    const prompt = `You are a helpful assistant that recommends credit cards.\n\nHere are the available credit cards (with their reward categories):\n${cardInfo}\n\nThe user is shopping at a merchant in the category '${category}'.\n\nPlease recommend the single best card for this merchant category, and explain your reasoning. Respond in the following format:\n\nCard Name: <name>\nReward: <reward for this category>\nReason: <short explanation>\n`;

    getOpenAIApiKey(async (apiKey) => {
      createOrUpdateBanner('<span style="color:gray;">Generating recommendation...</span>');
      if (apiKey && cards.length > 0) {
        try {
          const llmResponse = await callOpenAIChat(prompt, apiKey);
          createOrUpdateBanner(`<b>💳 Recommended Card:</b><br>${llmResponse}`);
        } catch (err) {
          createOrUpdateBanner(`<span style='color:red;'>LLM error: ${err.message}</span>`);
        }
      } else {
        createOrUpdateBanner('No recommendation available.');
      }
    });
  }

  // Create or update the recommendation banner
window.createOrUpdateBanner = function createOrUpdateBanner(html) {
    let banner = document.getElementById('cc-recommend-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'cc-recommend-banner';
      banner.style = 'padding:10px; background:#f5f7fa; border:1px solid #0074D9; border-radius:8px; position:fixed; top:20px; right:20px; z-index:99999; box-shadow:0 2px 8px #0002;';
      document.body.appendChild(banner);
    }
    banner.innerHTML = html;
    // Also save the latest recommendation to chrome.storage so popup can access it
    chrome.storage && chrome.storage.local && chrome.storage.local.set({ latestRecommendation: html });

    // If debug mode is on, show the debug log panel below the recommendation
    if (window.CC_DEBUG && Array.isArray(window.ccDebugLogs)) {
      let debugHtml = '<div style="margin-top:10px; max-height:120px; overflow:auto; background:#222; color:#eee; font-size:12px; border-radius:5px; padding:6px;">';
      debugHtml += '<b>Debug Log</b><br>';
      debugHtml += window.ccDebugLogs.map(l => `<div>${l}</div>`).join('');
      debugHtml += '</div>';
      banner.innerHTML += debugHtml;
    }
  }
