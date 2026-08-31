BEGIN;

ALTER TABLE franchise_locations
  ADD COLUMN IF NOT EXISTS franchisor text;

UPDATE franchise_locations AS location
SET franchisor = document.franchise_name
FROM fdd_documents AS document
WHERE location.document_id = document.id
  AND (location.franchisor IS NULL OR location.franchisor = '');

ALTER TABLE franchise_locations
  ALTER COLUMN franchisor SET DEFAULT '',
  ALTER COLUMN franchisor SET NOT NULL;

COMMIT;