SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_month_rates (
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE CASCADE,
  rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (schedule_month_id, profile_id)
);

COMMIT;
