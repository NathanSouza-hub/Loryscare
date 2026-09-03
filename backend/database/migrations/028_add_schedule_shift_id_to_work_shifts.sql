SET client_encoding TO 'UTF8';

BEGIN;

ALTER TABLE work_shifts
  ADD COLUMN schedule_shift_id BIGINT REFERENCES schedule_shifts(id) ON DELETE SET NULL,
  ADD COLUMN scheduled_start_at TIMESTAMP,
  ADD COLUMN scheduled_end_at TIMESTAMP;

CREATE UNIQUE INDEX idx_work_shifts_schedule_shift_once
  ON work_shifts (schedule_shift_id) WHERE schedule_shift_id IS NOT NULL;

COMMIT;
