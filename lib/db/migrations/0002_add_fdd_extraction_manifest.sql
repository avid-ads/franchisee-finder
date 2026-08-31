BEGIN;

ALTER TABLE fdd_documents
  ADD COLUMN IF NOT EXISTS extraction_manifest jsonb,
  ADD COLUMN IF NOT EXISTS last_processed_at timestamptz;

COMMIT;