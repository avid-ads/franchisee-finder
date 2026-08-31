CREATE INDEX IF NOT EXISTS "franchise_locations_franchisor_lower_idx"
  ON "franchise_locations" (lower("franchisor"));