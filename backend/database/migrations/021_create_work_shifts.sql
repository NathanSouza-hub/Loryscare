SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE work_shifts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMP NOT NULL,
  duration_hours SMALLINT NOT NULL CHECK (duration_hours IN (12, 24)),
  expected_end_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_work_shifts_user_started ON work_shifts (user_id, started_at DESC);

COMMIT;
