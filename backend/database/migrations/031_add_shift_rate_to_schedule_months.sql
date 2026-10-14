SET client_encoding TO 'UTF8';

BEGIN;

ALTER TABLE schedule_months
  ADD COLUMN IF NOT EXISTS shift_rate_cents INTEGER CHECK (shift_rate_cents >= 0);

COMMIT;
