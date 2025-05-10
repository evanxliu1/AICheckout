// cards.js

const cards = [
  {
    name: 'Chase Freedom Flex',
    category: 'Online Shopping',
    rate: '5% cashback',
    sites: ['amazon.com', 'walmart.com', 'target.com']
  },
  {
    name: 'Amex Gold',
    category: 'Groceries',
    rate: '4x points',
    sites: ['instacart.com', 'wholefoods.com']
  },
  {
    name: 'Citi Double Cash',
    category: 'All Purchases',
    rate: '2% cashback',
    sites: ['*']
  }
];

function getBestCardForSite(host) {
  // Normalize hostname (strip www.)
  const normalizedHost = host.startsWith('www.') ? host.slice(4) : host;
  // First, look for exact match
  for (const card of cards) {
    if (card.sites.includes(normalizedHost)) {
      return card;
    }
  }
  // If no exact match, look for wildcard
  for (const card of cards) {
    if (card.sites.includes('*')) {
      return card;
    }
  }
  return null;
}
// Make function globally accessible
window.getBestCardForSite = getBestCardForSite;
