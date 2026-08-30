SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_shift_swaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_shift_id BIGINT NOT NULL REFERENCES schedule_shifts(id) ON DELETE CASCADE,
  previous_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  new_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  changed_by_profile_id BIGINT REFERENCES caregiver_profiles(id),
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
