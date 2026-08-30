SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_months (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  duration_hours SMALLINT NOT NULL CHECK (duration_hours IN (12, 24)),
  first_start_time TIME NOT NULL,
  second_start_time TIME,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, year, month)
);

COMMIT;
