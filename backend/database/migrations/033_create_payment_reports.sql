SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE payment_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_day SMALLINT NOT NULL CHECK (cycle_day IN (5, 20)),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_by_profile_id BIGINT REFERENCES caregiver_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_payment_reports_user_period ON payment_reports (user_id, start_date DESC);

CREATE TABLE payment_report_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES payment_reports(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('shift', 'adjustment')),
  schedule_shift_id BIGINT REFERENCES schedule_shifts(id) ON DELETE SET NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  amount_cents INTEGER,
  description VARCHAR(120),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (kind <> 'shift' OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at)),
  CHECK (kind <> 'adjustment' OR amount_cents IS NOT NULL)
);

CREATE INDEX idx_payment_report_items_report ON payment_report_items (report_id);

COMMIT;
