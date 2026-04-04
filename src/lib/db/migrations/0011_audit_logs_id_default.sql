CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.audit_logs
ALTER COLUMN id SET DEFAULT replace(gen_random_uuid()::text, '-', '');
