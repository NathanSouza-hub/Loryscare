SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_shifts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_start_at TIMESTAMP NOT NULL,
  scheduled_end_at TIMESTAMP NOT NULL,
  original_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_shifts_month ON schedule_shifts (schedule_month_id);
CREATE INDEX idx_schedule_shifts_profile_window
  ON schedule_shifts (profile_id, scheduled_start_at, scheduled_end_at);

COMMIT;
