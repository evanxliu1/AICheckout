// popup.js
document.addEventListener('DOMContentLoaded', () => {
  // Inject cards.js if not present
  if (!window.getBestCardForSite) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('cards.js');
    script.onload = showRecommendation;
    document.head.appendChild(script);
  } else {
    showRecommendation();
  }

  function showRecommendation() {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const url = new URL(tabs[0].url);
      const host = url.hostname;
      const card = window.getBestCardForSite(host);
      const recDiv = document.getElementById('recommendation');
      if (card) {
        recDiv.innerHTML = `<b>${card.name}</b><br><small>${card.category} (${card.rate})</small>`;
      } else {
        recDiv.textContent = 'No recommendation for this site.';
      }
    });
  }
});
