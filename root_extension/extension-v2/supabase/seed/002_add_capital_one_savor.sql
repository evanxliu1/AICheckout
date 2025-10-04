-- Add Capital One Savor Rewards card
-- 3% cash back on groceries, dining, entertainment, and streaming
-- 1% cash back on all other purchases

INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Capital One Savor Rewards',
  95,
  '{
    "groceries": "3% cashback",
    "dining": "3% cashback",
    "entertainment": "3% cashback",
    "streaming": "3% cashback",
    "all": "1% cashback"
  }'::jsonb,
  'Earn 3% cash back on dining, entertainment, groceries, and popular streaming services. $95 annual fee.',
  TRUE
);

-- Verify the card was added
SELECT
  id,
  name,
  annual_fee,
  rewards,
  description,
  is_active,
  created_at
FROM credit_cards
WHERE name = 'Capital One Savor Rewards';
