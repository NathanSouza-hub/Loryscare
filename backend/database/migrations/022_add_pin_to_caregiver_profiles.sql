SET client_encoding TO 'UTF8';

BEGIN;

ALTER TABLE caregiver_profiles ADD COLUMN pin_hash VARCHAR(255);

COMMIT;
