SET client_encoding TO 'UTF8';

-- Aplicar somente depois que o código com valor único do plantão estiver publicado.
BEGIN;

DROP TABLE IF EXISTS schedule_month_rates;

COMMIT;
