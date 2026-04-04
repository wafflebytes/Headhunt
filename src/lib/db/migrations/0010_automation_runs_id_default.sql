CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.automation_runs
ALTER COLUMN id SET DEFAULT replace(gen_random_uuid()::text, '-', '');
