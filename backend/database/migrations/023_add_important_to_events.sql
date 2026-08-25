SET client_encoding TO 'UTF8';

BEGIN;

ALTER TABLE events ADD COLUMN important BOOLEAN NOT NULL DEFAULT true;

COMMIT;
