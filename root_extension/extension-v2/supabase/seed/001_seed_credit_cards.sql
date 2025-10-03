-- Seed initial credit cards data
-- Based on cards.json from original extension

-- Insert Chase Freedom Flex
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Chase Freedom Flex',
  0,
  '{
    "groceries": "5% cashback",
    "entertainment": "3% cashback",
    "online": "5% cashback",
    "travel": "5% cashback (rotating)",
    "all": "1% cashback"
  }'::jsonb,
  'Great for rotating 5% categories and online shopping. No annual fee.',
  TRUE
);

-- Insert Amex Gold
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Amex Gold',
  250,
  '{
    "groceries": "4x points",
    "dining": "4x points",
    "travel": "3x points",
    "all": "1x points"
  }'::jsonb,
  'Earns 4x points at U.S. supermarkets and restaurants. Excellent for foodies and families.',
  TRUE
);

-- Insert Citi Double Cash
INSERT INTO credit_cards (name, annual_fee, rewards, description, is_active)
VALUES (
  'Citi Double Cash',
  0,
  '{
    "all": "2% cashback"
  }'::jsonb,
  'Simple 2% cashback on everything. No annual fee. Great for general use.',
  TRUE
);

-- Verify data
SELECT
  id,
  name,
  annual_fee,
  rewards,
  description,
  is_active,
  created_at
FROM credit_cards
ORDER BY name;
