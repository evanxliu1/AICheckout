-- Create credit_cards table
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  annual_fee NUMERIC NOT NULL DEFAULT 0,
  rewards JSONB NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on is_active for performance
CREATE INDEX IF NOT EXISTS idx_credit_cards_is_active ON credit_cards(is_active);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_credit_cards_updated_at ON credit_cards;
CREATE TRIGGER update_credit_cards_updated_at
  BEFORE UPDATE ON credit_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access to active cards
DROP POLICY IF EXISTS "Allow public read access to active cards" ON credit_cards;
CREATE POLICY "Allow public read access to active cards"
  ON credit_cards
  FOR SELECT
  USING (is_active = TRUE);

-- Optional: Create policy for authenticated writes (admin only)
-- This requires authentication to be set up
-- DROP POLICY IF EXISTS "Allow authenticated write access" ON credit_cards;
-- CREATE POLICY "Allow authenticated write access"
--   ON credit_cards
--   FOR ALL
--   USING (auth.role() = 'authenticated');

-- Add comments for documentation
COMMENT ON TABLE credit_cards IS 'Credit card information for recommendations';
COMMENT ON COLUMN credit_cards.id IS 'Unique identifier for the card';
COMMENT ON COLUMN credit_cards.name IS 'Credit card name (e.g., Chase Freedom Flex)';
COMMENT ON COLUMN credit_cards.annual_fee IS 'Annual fee in dollars';
COMMENT ON COLUMN credit_cards.rewards IS 'JSONB object containing reward categories and values';
COMMENT ON COLUMN credit_cards.description IS 'Brief description of card benefits';
COMMENT ON COLUMN credit_cards.is_active IS 'Whether this card is active and should be recommended';
