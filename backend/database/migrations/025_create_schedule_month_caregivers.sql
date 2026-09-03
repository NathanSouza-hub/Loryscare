SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_month_caregivers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL,
  UNIQUE (schedule_month_id, profile_id),
  UNIQUE (schedule_month_id, position)
);

COMMIT;
