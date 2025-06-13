document.getElementById('sim-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const numCarts = document.getElementById('numCarts').value;
  document.getElementById('summary').innerHTML = `<span class="loading">Simulating... This may take a minute.</span>`;
  document.getElementById('details').innerHTML = '';

  const resp = await fetch('/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numCarts })
  });
  const data = await resp.json();

  document.getElementById('summary').innerHTML = `
    <strong>Total Orders:</strong> ${numCarts}<br>
    <strong>Total Spent:</strong> $${data.totalSpent}<br>
    <strong>Rewards (1% cashback):</strong> $${data.totalFlatRewards}<br>
    <strong>Rewards (AI Checkout):</strong> $${data.totalAIRewards}<br>
    <strong>Multiplier:</strong> <span style="color:#0074D9;font-weight:600;">${data.multiplier}x</span>
  `;

  let detailHTML = `<table>
    <tr>
      <th>#</th>
      <th>Cart Items</th>
      <th>Amount</th>
      <th>AI Card</th>
      <th>Category</th>
      <th>AI Reward</th>
      <th>Flat Reward</th>
      <th>Reward Rate</th>
    </tr>`;
  data.results.forEach((r, i) => {
    detailHTML += `<tr>
      <td>${i+1}</td>
      <td>${r.cart.join(', ')}</td>
      <td>$${r.amount.toFixed(2)}</td>
      <td>${r.recommendedCard || '-'}</td>
      <td>${r.inferredCategory || '-'}</td>
      <td>$${r.aiReward.toFixed(2)}</td>
      <td>$${r.flatReward.toFixed(2)}</td>
      <td>${r.rewardStr}</td>
    </tr>`;
  });
  detailHTML += `</table>`;
  document.getElementById('details').innerHTML = detailHTML;
});
