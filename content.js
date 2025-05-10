// content.js
(function() {
  // Only run on top-level frame
  if (window.top !== window.self) return;

  // Inject cards.js if not already present
  if (!window.getBestCardForSite) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('cards.js');
    script.onload = function() {
      recommendCard();
    };
    document.head.appendChild(script);
  } else {
    recommendCard();
  }

  function recommendCard() {
    const host = window.location.hostname;
    const card = window.getBestCardForSite(host);
    if (!card) return;
    // Create recommendation banner
    const banner = document.createElement('div');
    banner.id = 'cc-recommend-banner';
    banner.innerHTML = `
      <div style="padding:10px; background:#f5f7fa; border:1px solid #0074D9; border-radius:8px; position:fixed; top:20px; right:20px; z-index:99999; box-shadow:0 2px 8px #0002;">
        <b>💳 Recommended Card:</b><br>
        <span>${card.name}</span><br>
        <small>Best for: ${card.category} (${card.rate})</small>
      </div>
    `;
    document.body.appendChild(banner);
  }
})();
