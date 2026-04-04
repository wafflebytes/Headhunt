ALTER FUNCTION public.automation_enqueue_run(varchar, varchar, varchar, varchar, jsonb, timestamp, integer, varchar)
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.automation_replay_run(varchar)
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.automation_enqueue_watchdogs(integer, integer, integer, varchar)
  SECURITY DEFINER
  SET search_path = public;

ALTER FUNCTION public.automation_claim_due_runs(integer)
  SECURITY DEFINER
  SET search_path = public;

REVOKE ALL ON FUNCTION public.automation_enqueue_run(varchar, varchar, varchar, varchar, jsonb, timestamp, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_replay_run(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_enqueue_watchdogs(integer, integer, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_claim_due_runs(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.automation_enqueue_run(varchar, varchar, varchar, varchar, jsonb, timestamp, integer, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_replay_run(varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_enqueue_watchdogs(integer, integer, integer, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_claim_due_runs(integer) TO service_role;
